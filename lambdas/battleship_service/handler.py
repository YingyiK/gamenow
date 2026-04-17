import json
import os
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource("dynamodb")
ROOMS_TABLE = os.environ["ROOMS_TABLE"]
CONNECTIONS_TABLE = os.environ["CONNECTIONS_TABLE"]
BATTLESHIP_TABLE = os.environ["BATTLESHIP_TABLE"]
WS_ENDPOINT = os.environ["WS_ENDPOINT"]

apigw = boto3.client("apigatewaymanagementapi", endpoint_url=WS_ENDPOINT)

BOARD_SIZE = 10
DRAW_RESULT = "DRAW"
STANDARD_FLEET = [
    {"name": "carrier", "size": 5},
    {"name": "battleship", "size": 4},
    {"name": "cruiser", "size": 3},
    {"name": "submarine", "size": 3},
    {"name": "destroyer", "size": 2},
]
FLEET_BY_NAME = {ship["name"]: ship["size"] for ship in STANDARD_FLEET}


def _storage_room_id(path_room_id):
    """URL uses /battleship/7089; DynamoDB rooms + game rows use battleship#7089."""
    if not path_room_id:
        return path_room_id
    if "#" in path_room_id:
        return path_room_id
    return f"battleship#{path_room_id}"


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

    if http_method == "GET" and room_id and path == f"/battleship/{path_room_id}":
        return get_state(event, room_id, path_room_id)
    if http_method == "POST" and room_id and path.endswith("/setup"):
        return setup_ships(event, room_id, path_room_id)
    if http_method == "POST" and room_id and path.endswith("/fire"):
        return fire_shot(event, room_id, path_room_id)
    if http_method == "POST" and room_id and path.endswith("/forfeit"):
        return forfeit_game(event, room_id, path_room_id)
    return response(404, {"error": "Route not found"})


def get_state(event, room_id, path_room_id):
    query = event.get("queryStringParameters") or {}
    player_id = query.get("playerId")
    player_token = query.get("playerToken")
    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken query parameters are required"})

    try:
        room = _get_battleship_room(room_id)
        _require_room_player(room, player_id, player_token)
    except ValueError as exc:
        return _error_response(str(exc))

    game = _prepare_game_state(_get_game_item(room_id), room)
    return response(200, _viewer_state(game, room, player_id, path_room_id))


def setup_ships(event, room_id, path_room_id):
    body = json.loads(event.get("body") or "{}")
    player_id = body.get("playerId")
    player_token = body.get("playerToken")
    placements = body.get("placements")

    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken are required"})
    if not isinstance(placements, list):
        return response(400, {"error": "placements must be an array"})

    try:
        room = _get_battleship_room(room_id)
        _require_room_player(room, player_id, player_token)
        ships = _build_ships_from_placements(placements)
        game = _mutate_game(room, lambda current: _apply_setup(current, room, player_id, ships))
    except ValueError as exc:
        return _error_response(str(exc))

    if game["phase"] == "playing":
        _mark_room_playing(room_id)
        room = _get_battleship_room(room_id)
        game = _prepare_game_state(game, room)

    _broadcast_game_state(game, room, path_room_id)
    return response(200, _viewer_state(game, room, player_id, path_room_id))


def fire_shot(event, room_id, path_room_id):
    body = json.loads(event.get("body") or "{}")
    player_id = body.get("playerId")
    player_token = body.get("playerToken")
    row = body.get("row")
    col = body.get("col")

    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken are required"})
    if not isinstance(row, int) or not isinstance(col, int):
        return response(400, {"error": "row and col must be integers"})

    try:
        room = _get_battleship_room(room_id)
        _require_room_player(room, player_id, player_token)
        game = _mutate_game(room, lambda current: _apply_fire(current, room, player_id, row, col))
    except ValueError as exc:
        return _error_response(str(exc))

    if game["phase"] == "finished":
        _mark_room_finished(room_id)
        room = _get_battleship_room(room_id)
        game = _prepare_game_state(game, room)

    _broadcast_game_state(game, room, path_room_id)
    return response(200, _viewer_state(game, room, player_id, path_room_id))


def forfeit_game(event, room_id, path_room_id):
    body = json.loads(event.get("body") or "{}")
    player_id = body.get("playerId")
    player_token = body.get("playerToken")

    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken are required"})

    try:
        room = _get_battleship_room(room_id)
        _require_room_player(room, player_id, player_token)
    except ValueError as exc:
        return _error_response(str(exc))

    dynamodb.Table(BATTLESHIP_TABLE).delete_item(Key={"roomId": room_id})

    _reset_room_to_waiting(room_id)
    room = _get_battleship_room(room_id)

    _broadcast_room_event(room_id, {
        "type": "ROOM_UPDATED",
        "roomId": room_id,
        "status": "waiting",
    })

    return response(200, {"status": "waiting", "roomId": path_room_id})


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


def _apply_setup(game, room, player_id, ships):
    if game["winnerPlayerId"]:
        raise ValueError("Game is already finished")

    player_state = game["players"][player_id]
    player_state["ships"] = ships
    player_state["ready"] = True
    _recalculate_game_state(game, room)
    return game


def _apply_fire(game, room, player_id, row, col):
    _validate_coordinate(row, col)

    if game["phase"] != "playing":
        raise ValueError("Game is not in playing state")
    if player_id not in game["players"]:
        raise ValueError("Player is not part of this game")

    cell = _cell_id(row, col)
    player_state = game["players"][player_id]
    if any(shot["cell"] == cell for shot in player_state.get("shotsFired", [])):
        raise ValueError("You already fired at that cell")

    round_shots = game.setdefault("currentRoundShots", {})
    if round_shots.get(player_id):
        raise ValueError("You already submitted a shot this round")

    target_player_id = _opponent_player_id(game, player_id)
    if not target_player_id:
        raise ValueError("Waiting for an opponent")

    live_ship = _find_ship_at_cell(game["players"][target_player_id]["ships"], cell)
    round_shots[player_id] = {
        "cell": cell,
        "row": row,
        "col": col,
        "targetPlayerId": target_player_id,
        "result": "hit" if live_ship else "miss",
    }

    if len(round_shots) == len(game["playerOrder"]):
        _resolve_round(game)

    return game


def _resolve_round(game):
    snapshot = _deep_copy(game["players"])

    for shooter_id in game["playerOrder"]:
        shot = game["currentRoundShots"].get(shooter_id)
        if not shot:
            continue

        target_id = shot["targetPlayerId"]
        target_ship_before = _find_ship_at_cell(snapshot[target_id]["ships"], shot["cell"])
        live_ship = _find_ship_at_cell(game["players"][target_id]["ships"], shot["cell"])

        is_hit = target_ship_before is not None
        ship_name = target_ship_before["name"] if target_ship_before else None
        if is_hit and live_ship and shot["cell"] not in live_ship["hits"]:
            live_ship["hits"].append(shot["cell"])

        is_sunk = bool(live_ship and _is_ship_sunk(live_ship))
        result = "hit" if is_hit else "miss"

        game["players"][shooter_id]["shotsFired"].append({
            "round": game["roundNumber"],
            "cell": shot["cell"],
            "row": shot["row"],
            "col": shot["col"],
            "result": result,
            "targetPlayerId": target_id,
            "shipName": ship_name,
            "sunk": is_sunk,
        })
        game["players"][target_id]["shotsReceived"].append({
            "round": game["roundNumber"],
            "cell": shot["cell"],
            "row": shot["row"],
            "col": shot["col"],
            "result": result,
            "attackerPlayerId": shooter_id,
            "attackerPlayerName": game["players"][shooter_id]["playerName"],
        })

    sunk_players = [
        player_id for player_id in game["playerOrder"]
        if _all_ships_sunk(game["players"][player_id]["ships"])
    ]
    if len(sunk_players) == len(game["playerOrder"]):
        game["winnerPlayerId"] = DRAW_RESULT
        game["phase"] = "finished"
    elif len(sunk_players) == 1:
        remaining = [player_id for player_id in game["playerOrder"] if player_id not in sunk_players]
        game["winnerPlayerId"] = remaining[0] if remaining else DRAW_RESULT
        game["phase"] = "finished"

    game["currentRoundShots"] = {}
    game["lastResolvedRound"] = game["roundNumber"]
    if game["phase"] != "finished":
        game["roundNumber"] += 1


def _mutate_game(room, mutate_fn):
    table = dynamodb.Table(BATTLESHIP_TABLE)

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
    previous_phase = existing.get("phase") if existing else None
    room_players = room.get("players", [])
    room_player_ids = [player["playerId"] for player in room_players]
    current_players = game.get("players", {})

    game["players"] = {}
    for room_player in room_players:
        player_id = room_player["playerId"]
        player_state = _normalize_player_state(current_players.get(player_id))
        player_state["playerName"] = room_player.get("playerName")
        game["players"][player_id] = player_state

    game["playerOrder"] = room_player_ids
    game.setdefault("currentRoundShots", {})
    game.setdefault("roundNumber", 1)
    game.setdefault("lastResolvedRound", 0)
    _recalculate_game_state(game, room, previous_phase)
    return game


def _recalculate_game_state(game, room, previous_phase=None):
    player_ids = [player["playerId"] for player in room.get("players", [])]

    if game.get("winnerPlayerId"):
        game["phase"] = "finished"
        return
    if len(player_ids) < 2:
        if previous_phase == "playing" and len(player_ids) == 1:
            game["winnerPlayerId"] = player_ids[0]
            game["phase"] = "finished"
        else:
            game["phase"] = "waiting_for_players"
        game["currentRoundShots"] = {}
        return
    if all(game["players"][player_id]["ready"] for player_id in player_ids):
        game["phase"] = "playing"
        return

    game["phase"] = "setup"
    game["currentRoundShots"] = {}


def _default_game_state(room):
    now = _now()
    return {
        "roomId": room["roomId"],
        "createdAt": now,
        "updatedAt": now,
        "phase": "waiting_for_players",
        "winnerPlayerId": None,
        "playerOrder": [player["playerId"] for player in room.get("players", [])],
        "players": {
            player["playerId"]: {
                "playerName": player.get("playerName"),
                "ready": False,
                "ships": [],
                "shotsFired": [],
                "shotsReceived": [],
            }
            for player in room.get("players", [])
        },
        "roundNumber": 1,
        "lastResolvedRound": 0,
        "currentRoundShots": {},
    }


def _normalize_player_state(state):
    state = _deep_copy(state) if state else {}
    state.setdefault("playerName", None)
    state.setdefault("ready", False)
    state.setdefault("ships", [])
    state.setdefault("shotsFired", [])
    state.setdefault("shotsReceived", [])
    return state


def _viewer_state(game, room, viewer_player_id, path_room_id):
    own_state = game["players"].get(viewer_player_id, _empty_player_state())
    opponent_player_id = _opponent_player_id(game, viewer_player_id)
    opponent_state = game["players"].get(opponent_player_id, _empty_player_state()) if opponent_player_id else _empty_player_state()
    your_shot = game.get("currentRoundShots", {}).get(viewer_player_id)

    return {
        "roomId": _numeric_room_for_api(path_room_id, room),
        "gameType": "battleship",
        "phase": game["phase"],
        "roundNumber": game["roundNumber"],
        "lastResolvedRound": game.get("lastResolvedRound", 0),
        "winnerPlayerId": game.get("winnerPlayerId"),
        "hostPlayerId": _current_host_player_id(room),
        "hostPlayerName": _current_host_player_name(room),
        "youPlayerId": viewer_player_id,
        "youPlayerName": own_state.get("playerName"),
        "shotSubmittedThisRound": your_shot is not None,
        "waitingForOpponent": game["phase"] == "playing" and your_shot is not None and len(game.get("currentRoundShots", {})) < len(game["playerOrder"]),
        "canFire": game["phase"] == "playing" and your_shot is None and game.get("winnerPlayerId") is None,
        "fleet": STANDARD_FLEET,
        "players": [
            {
                "playerId": player["playerId"],
                "playerName": player.get("playerName"),
                "ready": game["players"].get(player["playerId"], {}).get("ready", False),
                "seatIndex": index,
                "isHost": player["playerId"] == _current_host_player_id(room),
                "submittedShotThisRound": player["playerId"] in game.get("currentRoundShots", {}),
            }
            for index, player in enumerate(room.get("players", []))
        ],
        "currentRound": {
            "yourShot": your_shot,
            "opponentSubmitted": bool(opponent_player_id and game.get("currentRoundShots", {}).get(opponent_player_id)),
        },
        "ownBoard": {
            "ships": [_public_ship(ship) for ship in own_state.get("ships", [])],
            "shotsReceived": own_state.get("shotsReceived", []),
        },
        "opponentBoard": {
            "playerId": opponent_player_id,
            "playerName": opponent_state.get("playerName"),
            "shotsFired": own_state.get("shotsFired", []),
            "remainingShipCells": _remaining_ship_cells(opponent_state.get("ships", [])) if game.get("winnerPlayerId") else None,
        },
        "room": {
            "status": room.get("status"),
            "players": [
                {
                    "playerId": player["playerId"],
                    "playerName": player.get("playerName"),
                    "joinedAt": player["joinedAt"],
                }
                for player in room.get("players", [])
            ],
        },
    }


def _public_ship(ship):
    return {
        "name": ship["name"],
        "cells": ship["cells"],
        "hits": ship["hits"],
        "sunk": _is_ship_sunk(ship),
    }


def _broadcast_game_state(game, room, path_room_id):
    for connection in _get_room_connection_records(room["roomId"]):
        player_id = connection.get("playerId")
        if not player_id or player_id not in game.get("players", {}):
            continue

        payload = json.dumps({
            "type": "GAME_STATE",
            "state": _viewer_state(game, room, player_id, path_room_id),
        }, default=_json_default).encode()
        try:
            apigw.post_to_connection(ConnectionId=connection["connectionId"], Data=payload)
        except apigw.exceptions.GoneException:
            dynamodb.Table(CONNECTIONS_TABLE).delete_item(Key={"connectionId": connection["connectionId"]})


def _assert_ships_not_adjacent(ships):
    """No cell of one ship may be 8-neighbor-adjacent to a cell of another ship."""
    for i, ship_a in enumerate(ships):
        for j, ship_b in enumerate(ships):
            if i >= j:
                continue
            for ca in ship_a["cells"]:
                ra, ca_col = map(int, ca.split(","))
                for cb in ship_b["cells"]:
                    rb, cb_col = map(int, cb.split(","))
                    if abs(ra - rb) <= 1 and abs(ca_col - cb_col) <= 1:
                        raise ValueError(
                            "Ships cannot be adjacent (including diagonally); leave a gap between ships"
                        )


def _build_ships_from_placements(placements):
    if len(placements) != len(STANDARD_FLEET):
        raise ValueError("placements must include exactly five ships")

    seen_names = set()
    occupied_cells = set()
    ships = []

    for placement in placements:
        name = placement.get("name")
        if name not in FLEET_BY_NAME:
            raise ValueError(f"Unknown ship name: {name}")
        if name in seen_names:
            raise ValueError(f"Duplicate ship placement: {name}")

        start_row = placement.get("startRow")
        start_col = placement.get("startCol")
        orientation = placement.get("orientation")
        if not isinstance(start_row, int) or not isinstance(start_col, int):
            raise ValueError(f"{name} must include integer startRow and startCol")
        if orientation not in ("horizontal", "vertical"):
            raise ValueError(f"{name} orientation must be horizontal or vertical")

        cells = []
        for step in range(FLEET_BY_NAME[name]):
            row = start_row + (step if orientation == "vertical" else 0)
            col = start_col + (step if orientation == "horizontal" else 0)
            _validate_coordinate(row, col)
            cell = _cell_id(row, col)
            if cell in occupied_cells:
                raise ValueError("Ships cannot overlap")
            cells.append(cell)
            occupied_cells.add(cell)

        ships.append({
            "name": name,
            "cells": cells,
            "hits": [],
        })
        seen_names.add(name)

    missing = sorted(set(FLEET_BY_NAME) - seen_names)
    if missing:
        raise ValueError(f"Missing ship placements: {', '.join(missing)}")

    _assert_ships_not_adjacent(ships)
    return ships


def _get_battleship_room(room_id):
    room = dynamodb.Table(ROOMS_TABLE).get_item(Key={"roomId": room_id}).get("Item")
    if not room:
        raise ValueError("Room not found")
    if room.get("gameType") != "battleship":
        raise ValueError("Room is not a battleship room")
    return room


def _require_room_player(room, player_id, player_token):
    for player in room.get("players", []):
        if player["playerId"] == player_id and player.get("playerToken") == player_token:
            return player
    raise ValueError("Invalid player credentials for this room")


def _get_game_item(room_id):
    return dynamodb.Table(BATTLESHIP_TABLE).get_item(Key={"roomId": room_id}).get("Item")


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


def _find_ship_at_cell(ships, cell):
    for ship in ships:
        if cell in ship["cells"]:
            return ship
    return None


def _all_ships_sunk(ships):
    return bool(ships) and all(_is_ship_sunk(ship) for ship in ships)


def _is_ship_sunk(ship):
    return set(ship["cells"]) == set(ship["hits"])


def _opponent_player_id(game, player_id):
    for other_player_id in game.get("playerOrder", []):
        if other_player_id != player_id:
            return other_player_id
    return None


def _current_host_player_id(room):
    players = room.get("players", [])
    return players[0]["playerId"] if players else None


def _current_host_player_name(room):
    players = room.get("players", [])
    return players[0].get("playerName") if players else None


def _mark_room_playing(room_id):
    dynamodb.Table(ROOMS_TABLE).update_item(
        Key={"roomId": room_id},
        UpdateExpression="SET #status = :playing, updatedAt = :updatedAt REMOVE expiresAt",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":playing": "playing",
            ":updatedAt": _now(),
        },
    )


def _mark_room_finished(room_id):
    dynamodb.Table(ROOMS_TABLE).update_item(
        Key={"roomId": room_id},
        UpdateExpression="SET #status = :finished, updatedAt = :updatedAt",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":finished": "finished",
            ":updatedAt": _now(),
        },
    )


def _reset_room_to_waiting(room_id):
    ttl = int((datetime.now(timezone.utc).timestamp())) + 86400
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


def _broadcast_room_event(room_id, message):
    payload = json.dumps(message, default=_json_default).encode()
    for connection in _get_room_connection_records(room_id):
        try:
            apigw.post_to_connection(ConnectionId=connection["connectionId"], Data=payload)
        except apigw.exceptions.GoneException:
            dynamodb.Table(CONNECTIONS_TABLE).delete_item(Key={"connectionId": connection["connectionId"]})
        except Exception:
            pass


def _remaining_ship_cells(ships):
    remaining = 0
    for ship in ships:
        remaining += len(set(ship["cells"]) - set(ship["hits"]))
    return remaining


def _empty_player_state():
    return {
        "playerName": None,
        "ready": False,
        "ships": [],
        "shotsFired": [],
        "shotsReceived": [],
    }


def _validate_coordinate(row, col):
    if not (0 <= row < BOARD_SIZE and 0 <= col < BOARD_SIZE):
        raise ValueError("Coordinates must be between 0 and 9")


def _cell_id(row, col):
    return f"{row},{col}"


def _deep_copy(value):
    return json.loads(json.dumps(value, default=_json_default))


def _json_default(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj == int(obj) else float(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def _now():
    return datetime.now(timezone.utc).isoformat()
