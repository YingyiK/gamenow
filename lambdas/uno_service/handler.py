import json
import os
import random
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource("dynamodb")
ROOMS_TABLE = os.environ["ROOMS_TABLE"]
CONNECTIONS_TABLE = os.environ["CONNECTIONS_TABLE"]
UNO_TABLE = os.environ["UNO_TABLE"]
WS_ENDPOINT = os.environ["WS_ENDPOINT"]

apigw = boto3.client("apigatewaymanagementapi", endpoint_url=WS_ENDPOINT)

# ---------------------------------------------------------------------------
# Card definitions
# ---------------------------------------------------------------------------

COLORS = ["Red", "Green", "Blue", "Yellow"]
NUMBER_CARDS = [str(n) for n in range(0, 10)]  # 0 once, 1-9 twice per color
SPECIAL_CARDS = ["Skip", "Reverse", "+2"]
WILD_CARDS = ["Wild", "Wild+4"]

def _build_deck():
    deck = []
    for color in COLORS:
        deck.append({"color": color, "value": "0"})
        for value in NUMBER_CARDS[1:]:          # 1-9 twice
            deck.extend([{"color": color, "value": value}] * 2)
        for value in SPECIAL_CARDS:             # Skip / Reverse / +2 twice
            deck.extend([{"color": color, "value": value}] * 2)
    for _ in range(4):                          # 4 of each wild
        deck.append({"color": "Wild", "value": "Wild"})
        deck.append({"color": "Wild", "value": "Wild+4"})
    random.shuffle(deck)
    return deck

def _card_str(card):
    return f"{card['color']}:{card['value']}"

def _str_card(s):
    color, value = s.split(":", 1)
    return {"color": color, "value": value}


# ---------------------------------------------------------------------------
# Lambda entry point
# ---------------------------------------------------------------------------

def _storage_room_id(path_room_id):
    if not path_room_id:
        return path_room_id
    if "#" in path_room_id:
        return path_room_id
    return f"uno#{path_room_id}"


def _numeric_room_for_api(path_room_id, room):
    if path_room_id and "#" not in path_room_id:
        return path_room_id
    rid = room.get("roomId")
    if isinstance(rid, str) and "#" in rid:
        return rid.split("#", 1)[1]
    return rid


def lambda_handler(event, context):
    http_method = event.get("httpMethod", "")
    path = event.get("path", "")
    path_room_id = (event.get("pathParameters") or {}).get("roomId")
    room_id = _storage_room_id(path_room_id)

    if http_method == "GET" and room_id and path == f"/uno/{path_room_id}":
        return get_state(event, room_id, path_room_id)
    if http_method == "POST" and room_id and path.endswith("/start"):
        return start_game(event, room_id, path_room_id)
    if http_method == "POST" and room_id and path.endswith("/play"):
        return play_card(event, room_id, path_room_id)
    if http_method == "POST" and room_id and path.endswith("/draw"):
        return draw_card(event, room_id, path_room_id)
    if http_method == "POST" and room_id and path.endswith("/uno"):
        return say_uno(event, room_id, path_room_id)
    if http_method == "POST" and room_id and path.endswith("/forfeit"):
        return forfeit_game(event, room_id, path_room_id)
    return response(404, {"error": "Route not found"})


# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------

def get_state(event, room_id, path_room_id):
    query = event.get("queryStringParameters") or {}
    player_id = query.get("playerId")
    player_token = query.get("playerToken")
    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken query parameters are required"})

    try:
        room = _get_uno_room(room_id)
        _require_room_player(room, player_id, player_token)
    except ValueError as exc:
        return _error_response(str(exc))

    game = _prepare_game_state(_get_game_item(room_id), room)
    return response(200, _viewer_state(game, room, player_id, path_room_id))


def start_game(event, room_id, path_room_id):
    body = json.loads(event.get("body") or "{}")
    player_id = body.get("playerId")
    player_token = body.get("playerToken")

    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken are required"})

    try:
        room = _get_uno_room(room_id)
        _require_room_player(room, player_id, player_token)
        host_player_id = _current_host_player_id(room)
        if player_id != host_player_id:
            raise ValueError("Only the host can start the game")
        if len(room.get("players", [])) < 2:
            raise ValueError("Need at least 2 players to start")
        game = _mutate_game(room, lambda current: _apply_start(current, room))
    except ValueError as exc:
        return _error_response(str(exc))

    _mark_room_playing(room_id)
    room = _get_uno_room(room_id)
    game = _prepare_game_state(game, room)
    _broadcast_game_state(game, room, path_room_id)
    return response(200, _viewer_state(game, room, player_id, path_room_id))


def play_card(event, room_id, path_room_id):
    body = json.loads(event.get("body") or "{}")
    player_id = body.get("playerId")
    player_token = body.get("playerToken")
    card_str = body.get("card")           # e.g. "Red:5" or "Wild:Wild+4"
    chosen_color = body.get("chosenColor")  # required when playing a wild card

    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken are required"})
    if not card_str:
        return response(400, {"error": "card is required"})

    try:
        room = _get_uno_room(room_id)
        _require_room_player(room, player_id, player_token)
        game = _mutate_game(
            room,
            lambda current: _apply_play_card(current, room, player_id, card_str, chosen_color),
        )
    except ValueError as exc:
        return _error_response(str(exc))

    if game["phase"] == "finished":
        _mark_room_finished(room_id)
        room = _get_uno_room(room_id)
        game = _prepare_game_state(game, room)

    _broadcast_game_state(game, room, path_room_id)
    return response(200, _viewer_state(game, room, player_id, path_room_id))


def draw_card(event, room_id, path_room_id):
    body = json.loads(event.get("body") or "{}")
    player_id = body.get("playerId")
    player_token = body.get("playerToken")

    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken are required"})

    try:
        room = _get_uno_room(room_id)
        _require_room_player(room, player_id, player_token)
        game = _mutate_game(room, lambda current: _apply_draw(current, room, player_id))
    except ValueError as exc:
        return _error_response(str(exc))

    _broadcast_game_state(game, room, path_room_id)
    return response(200, _viewer_state(game, room, player_id, path_room_id))


def say_uno(event, room_id, path_room_id):
    body = json.loads(event.get("body") or "{}")
    player_id = body.get("playerId")
    player_token = body.get("playerToken")

    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken are required"})

    try:
        room = _get_uno_room(room_id)
        _require_room_player(room, player_id, player_token)
        game = _mutate_game(room, lambda current: _apply_say_uno(current, player_id))
    except ValueError as exc:
        return _error_response(str(exc))

    _broadcast_game_state(game, room, path_room_id)
    return response(200, _viewer_state(game, room, player_id, path_room_id))


def forfeit_game(event, room_id, path_room_id):
    body = json.loads(event.get("body") or "{}")
    player_id = body.get("playerId")
    player_token = body.get("playerToken")

    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken are required"})

    try:
        room = _get_uno_room(room_id)
        _require_room_player(room, player_id, player_token)
    except ValueError as exc:
        return _error_response(str(exc))

    dynamodb.Table(UNO_TABLE).delete_item(Key={"roomId": room_id})
    _reset_room_to_waiting(room_id)
    room = _get_uno_room(room_id)

    _broadcast_room_event(room_id, {
        "type": "ROOM_UPDATED",
        "roomId": room_id,
        "status": "waiting",
    })
    return response(200, {"roomId": path_room_id, "status": "waiting"})


# ---------------------------------------------------------------------------
# Game mutation logic
# ---------------------------------------------------------------------------

def _apply_start(game, room):
    if game["phase"] not in ("waiting_for_players", "finished"):
        raise ValueError("Game has already started")

    players = room.get("players", [])
    if len(players) < 2:
        raise ValueError("Need at least 2 players to start")

    deck = _build_deck()
    hand_size = 7
    hands = {}
    for player in players:
        pid = player["playerId"]
        hands[pid] = [_card_str(deck.pop()) for _ in range(hand_size)]

    # First face-up card must not be a wild
    top_card = deck.pop()
    while top_card["color"] == "Wild":
        deck.insert(0, top_card)
        top_card = deck.pop()

    game["drawPile"] = [_card_str(c) for c in deck]
    game["discardPile"] = [_card_str(top_card)]
    game["currentColor"] = top_card["color"]
    game["currentPlayerIndex"] = 0
    game["direction"] = 1
    game["pendingDrawCount"] = 0
    game["phase"] = "playing"
    game["winnerPlayerId"] = None

    for player in players:
        pid = player["playerId"]
        game["players"][pid]["hand"] = hands[pid]
        game["players"][pid]["saidUno"] = False
        game["players"][pid]["ready"] = True

    # Apply effect of the first card if it is a special card
    _apply_top_card_effect(game, top_card)
    return game


def _apply_play_card(game, room, player_id, card_str, chosen_color):
    if game["phase"] != "playing":
        raise ValueError("Game is not in playing state")

    player_order = game["playerOrder"]
    current_pid = player_order[game["currentPlayerIndex"]]
    if player_id != current_pid:
        raise ValueError("It is not your turn")

    hand = game["players"][player_id]["hand"]
    if card_str not in hand:
        raise ValueError("You do not have that card")

    card = _str_card(card_str)

    # Validate the play
    top_str = game["discardPile"][-1]
    top = _str_card(top_str)
    current_color = game["currentColor"]

    is_wild = card["color"] == "Wild"
    color_match = card["color"] == current_color
    value_match = card["value"] == top["value"]

    # Pending stack: only +2 on +2, or Wild+4 on Wild+4 allowed
    pending = game.get("pendingDrawCount", 0)
    if pending > 0:
        if card["value"] == "+2" and top["value"] in ("+2", "Wild+4"):
            pass  # allowed to stack
        elif card["value"] == "Wild+4":
            pass  # always stackable on top of pending
        else:
            raise ValueError(f"You must play a draw card or draw {pending} cards")

    if not is_wild and not color_match and not value_match:
        raise ValueError("Card does not match the current color or value")

    if is_wild and not chosen_color:
        raise ValueError("chosenColor is required when playing a wild card")
    if chosen_color and chosen_color not in COLORS:
        raise ValueError("chosenColor must be Red, Green, Blue, or Yellow")

    # Remove card from hand
    hand.remove(card_str)
    game["players"][player_id]["hand"] = hand
    game["players"][player_id]["saidUno"] = False

    # Place on discard
    game["discardPile"].append(card_str)
    game["currentColor"] = chosen_color if is_wild else card["color"]

    # Check win
    if len(hand) == 0:
        game["winnerPlayerId"] = player_id
        game["phase"] = "finished"
        return game

    # Apply card effect and advance turn
    _apply_card_effect(game, card, player_order)
    return game


def _apply_card_effect(game, card, player_order):
    n = len(player_order)
    current_idx = game["currentPlayerIndex"]

    if card["value"] == "Reverse":
        game["direction"] *= -1
        if n == 2:
            # In 2-player, Reverse acts like Skip
            game["currentPlayerIndex"] = (current_idx + game["direction"]) % n
        else:
            game["currentPlayerIndex"] = (current_idx + game["direction"]) % n

    elif card["value"] == "Skip":
        # Skip next player: advance twice
        game["currentPlayerIndex"] = (current_idx + game["direction"] * 2) % n

    elif card["value"] == "+2":
        game["pendingDrawCount"] = game.get("pendingDrawCount", 0) + 2
        game["currentPlayerIndex"] = (current_idx + game["direction"]) % n

    elif card["value"] == "Wild+4":
        game["pendingDrawCount"] = game.get("pendingDrawCount", 0) + 4
        game["currentPlayerIndex"] = (current_idx + game["direction"]) % n

    else:
        # Normal card or Wild: just advance
        game["currentPlayerIndex"] = (current_idx + game["direction"]) % n
        game["pendingDrawCount"] = 0


def _apply_top_card_effect(game, top_card):
    """Apply the effect of the very first face-up card."""
    player_order = game["playerOrder"]
    n = len(player_order)

    if top_card["value"] == "Reverse":
        game["direction"] = -1
        game["currentPlayerIndex"] = (n - 1) % n
    elif top_card["value"] == "Skip":
        game["currentPlayerIndex"] = 1 % n
    elif top_card["value"] == "+2":
        game["pendingDrawCount"] = 2
        # First player must draw; turn still starts at index 0


def _apply_draw(game, room, player_id):
    if game["phase"] != "playing":
        raise ValueError("Game is not in playing state")

    player_order = game["playerOrder"]
    current_pid = player_order[game["currentPlayerIndex"]]
    if player_id != current_pid:
        raise ValueError("It is not your turn")

    pending = game.get("pendingDrawCount", 0)
    draw_count = pending if pending > 0 else 1

    drawn = _draw_cards(game, draw_count)
    game["players"][player_id]["hand"].extend(drawn)
    game["players"][player_id]["saidUno"] = False
    game["pendingDrawCount"] = 0

    # After drawing, advance turn
    n = len(player_order)
    game["currentPlayerIndex"] = (game["currentPlayerIndex"] + game["direction"]) % n
    return game


def _apply_say_uno(game, player_id):
    if game["phase"] != "playing":
        raise ValueError("Game is not in playing state")
    if player_id not in game["players"]:
        raise ValueError("Player is not in this game")

    hand = game["players"][player_id]["hand"]
    if len(hand) != 1:
        raise ValueError("You can only say UNO when you have exactly 1 card")

    game["players"][player_id]["saidUno"] = True
    return game


def _draw_cards(game, count):
    drawn = []
    for _ in range(count):
        if not game["drawPile"]:
            # Reshuffle discard pile (keep top card)
            top = game["discardPile"][-1]
            reshuffle = game["discardPile"][:-1]
            random.shuffle(reshuffle)
            game["drawPile"] = reshuffle
            game["discardPile"] = [top]
        if game["drawPile"]:
            drawn.append(game["drawPile"].pop())
    return drawn


# ---------------------------------------------------------------------------
# State management (mirrors A's _mutate_game / _prepare_game_state pattern)
# ---------------------------------------------------------------------------

def _mutate_game(room, mutate_fn):
    table = dynamodb.Table(UNO_TABLE)

    for _ in range(3):
        existing = _get_game_item(room["roomId"])
        game = _prepare_game_state(existing, room)
        expected_updated_at = existing.get("updatedAt") if existing else None

        mutate_fn(game)
        game["updatedAt"] = _now()

        try:
            if existing:
                table.put_item(
                    Item=game,
                    ConditionExpression="updatedAt = :expectedUpdatedAt",
                    ExpressionAttributeValues={":expectedUpdatedAt": expected_updated_at},
                )
            else:
                table.put_item(
                    Item=game,
                    ConditionExpression="attribute_not_exists(roomId)",
                )
            return game
        except ClientError as exc:
            if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise

    raise ValueError("Game changed while updating, please retry")


def _prepare_game_state(existing, room):
    game = _deep_copy(existing) if existing else _default_game_state(room)
    room_players = room.get("players", [])
    room_player_ids = [p["playerId"] for p in room_players]
    current_players = game.get("players", {})

    game["players"] = {}
    for room_player in room_players:
        pid = room_player["playerId"]
        player_state = _normalize_player_state(current_players.get(pid))
        player_state["playerName"] = room_player.get("playerName")
        game["players"][pid] = player_state

    game["playerOrder"] = room_player_ids
    game.setdefault("drawPile", [])
    game.setdefault("discardPile", [])
    game.setdefault("currentColor", None)
    game.setdefault("currentPlayerIndex", 0)
    game.setdefault("direction", 1)
    game.setdefault("pendingDrawCount", 0)
    return game


def _default_game_state(room):
    now = _now()
    return {
        "roomId": room["roomId"],
        "createdAt": now,
        "updatedAt": now,
        "phase": "waiting_for_players",
        "winnerPlayerId": None,
        "playerOrder": [p["playerId"] for p in room.get("players", [])],
        "players": {
            p["playerId"]: _normalize_player_state(None)
            for p in room.get("players", [])
        },
        "drawPile": [],
        "discardPile": [],
        "currentColor": None,
        "currentPlayerIndex": 0,
        "direction": 1,
        "pendingDrawCount": 0,
    }


def _normalize_player_state(state):
    state = _deep_copy(state) if state else {}
    state.setdefault("playerName", None)
    state.setdefault("hand", [])
    state.setdefault("saidUno", False)
    state.setdefault("ready", False)
    return state


# ---------------------------------------------------------------------------
# Viewer state (hides other players' hands)
# ---------------------------------------------------------------------------

def _viewer_state(game, room, viewer_player_id, path_room_id):
    player_order = game.get("playerOrder", [])
    current_pid = player_order[game["currentPlayerIndex"]] if player_order else None
    top_card = game["discardPile"][-1] if game["discardPile"] else None

    return {
        "roomId": _numeric_room_for_api(path_room_id, room),
        "gameType": "uno",
        "phase": game["phase"],
        "winnerPlayerId": game.get("winnerPlayerId"),
        "hostPlayerId": _current_host_player_id(room),
        "hostPlayerName": _current_host_player_name(room),
        "youPlayerId": viewer_player_id,
        "youPlayerName": game["players"].get(viewer_player_id, {}).get("playerName"),
        "currentPlayerId": current_pid,
        "isYourTurn": current_pid == viewer_player_id,
        "direction": game["direction"],
        "currentColor": game["currentColor"],
        "topCard": top_card,
        "pendingDrawCount": game.get("pendingDrawCount", 0),
        "drawPileCount": len(game.get("drawPile", [])),
        # Your private hand
        "yourHand": game["players"].get(viewer_player_id, {}).get("hand", []),
        "yourSaidUno": game["players"].get(viewer_player_id, {}).get("saidUno", False),
        # Other players — hand size only, not the actual cards
        "players": [
            {
                "playerId": p["playerId"],
                "playerName": game["players"].get(p["playerId"], {}).get("playerName"),
                "seatIndex": idx,
                "isHost": p["playerId"] == _current_host_player_id(room),
                "isCurrentPlayer": p["playerId"] == current_pid,
                "handCount": len(game["players"].get(p["playerId"], {}).get("hand", [])),
                "saidUno": game["players"].get(p["playerId"], {}).get("saidUno", False),
            }
            for idx, p in enumerate(room.get("players", []))
        ],
        "room": {
            "status": room.get("status"),
            "players": [
                {
                    "playerId": p["playerId"],
                    "playerName": p.get("playerName"),
                    "joinedAt": p["joinedAt"],
                }
                for p in room.get("players", [])
            ],
        },
    }


# ---------------------------------------------------------------------------
# Broadcast helpers (identical pattern to A's code)
# ---------------------------------------------------------------------------

def _broadcast_game_state(game, room, path_room_id):
    for connection in _get_room_connection_records(room["roomId"]):
        pid = connection.get("playerId")
        if not pid or pid not in game.get("players", {}):
            continue
        payload = json.dumps({
            "type": "GAME_STATE",
            "state": _viewer_state(game, room, pid, path_room_id),
        }, default=_json_default).encode()
        try:
            apigw.post_to_connection(ConnectionId=connection["connectionId"], Data=payload)
        except apigw.exceptions.GoneException:
            dynamodb.Table(CONNECTIONS_TABLE).delete_item(
                Key={"connectionId": connection["connectionId"]}
            )


def _broadcast_room_event(room_id, message):
    payload = json.dumps(message, default=_json_default).encode()
    for connection in _get_room_connection_records(room_id):
        try:
            apigw.post_to_connection(ConnectionId=connection["connectionId"], Data=payload)
        except apigw.exceptions.GoneException:
            dynamodb.Table(CONNECTIONS_TABLE).delete_item(
                Key={"connectionId": connection["connectionId"]}
            )
        except Exception:
            pass


# ---------------------------------------------------------------------------
# DynamoDB helpers
# ---------------------------------------------------------------------------

def _get_uno_room(room_id):
    room = dynamodb.Table(ROOMS_TABLE).get_item(Key={"roomId": room_id}).get("Item")
    if not room:
        raise ValueError("Room not found")
    if room.get("gameType") != "uno":
        raise ValueError("Room is not a UNO room")
    return room


def _require_room_player(room, player_id, player_token):
    for player in room.get("players", []):
        if player["playerId"] == player_id and player.get("playerToken") == player_token:
            return player
    raise ValueError("Invalid player credentials for this room")


def _get_game_item(room_id):
    return dynamodb.Table(UNO_TABLE).get_item(Key={"roomId": room_id}).get("Item")


def _get_room_connection_records(room_id):
    conn_table = dynamodb.Table(CONNECTIONS_TABLE)
    query_result = conn_table.query(
        IndexName="roomId-index",
        KeyConditionExpression=boto3.dynamodb.conditions.Key("roomId").eq(room_id),
    )
    records = []
    for item in query_result.get("Items", []):
        connection = conn_table.get_item(Key={"connectionId": item["connectionId"]}).get("Item")
        if connection:
            records.append(connection)
    return records


def _mark_room_playing(room_id):
    dynamodb.Table(ROOMS_TABLE).update_item(
        Key={"roomId": room_id},
        UpdateExpression="SET #status = :playing, updatedAt = :updatedAt REMOVE expiresAt",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={":playing": "playing", ":updatedAt": _now()},
    )


def _mark_room_finished(room_id):
    dynamodb.Table(ROOMS_TABLE).update_item(
        Key={"roomId": room_id},
        UpdateExpression="SET #status = :finished, updatedAt = :updatedAt",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={":finished": "finished", ":updatedAt": _now()},
    )


def _reset_room_to_waiting(room_id):
    ttl = int(datetime.now(timezone.utc).timestamp()) + 86400
    dynamodb.Table(ROOMS_TABLE).update_item(
        Key={"roomId": room_id},
        UpdateExpression="SET #status = :waiting, updatedAt = :updatedAt, expiresAt = :ttl",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":waiting": "waiting",
            ":updatedAt": _now(),
            ":ttl": ttl,
        },
    )


def _current_host_player_id(room):
    players = room.get("players", [])
    return players[0]["playerId"] if players else None


def _current_host_player_name(room):
    players = room.get("players", [])
    return players[0].get("playerName") if players else None


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body, default=str),
    }


def _error_response(message):
    if message == "Room not found":
        return response(404, {"error": message})
    if message == "Invalid player credentials for this room":
        return response(403, {"error": message})
    return response(400, {"error": message})


def _deep_copy(value):
    return json.loads(json.dumps(value, default=_json_default))


def _json_default(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj == int(obj) else float(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def _now():
    return datetime.now(timezone.utc).isoformat()