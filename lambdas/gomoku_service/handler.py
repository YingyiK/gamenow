import json
import os
import random
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource("dynamodb")
ROOMS_TABLE = os.environ["ROOMS_TABLE"]
CONNECTIONS_TABLE = os.environ["CONNECTIONS_TABLE"]
GOMOKU_TABLE = os.environ["GOMOKU_TABLE"]
WS_ENDPOINT = os.environ["WS_ENDPOINT"]

apigw = boto3.client("apigatewaymanagementapi", endpoint_url=WS_ENDPOINT)

BOARD_SIZE = 15
DIRECTIONS = [(0, 1), (1, 0), (1, 1), (1, -1)]
WIN_LENGTH = 5
DRAW_RESULT = "DRAW"
WAITING_ROOM_TTL_HOURS = 24


def _storage_room_id(path_room_id):
    if not path_room_id:
        return path_room_id
    if "#" in path_room_id:
        return path_room_id
    return f"gomoku#{path_room_id}"


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

    if http_method == "GET" and room_id:
        return get_state(event, room_id, path_room_id)
    if http_method == "POST" and room_id and path.endswith("/ready"):
        return player_ready(event, room_id, path_room_id)
    if http_method == "POST" and room_id and path.endswith("/place"):
        return place_stone(event, room_id, path_room_id)
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
        room = _get_gomoku_room(room_id)
        _require_room_player(room, player_id, player_token)
    except ValueError as exc:
        return _error_response(str(exc))

    game = _prepare_game_state(_get_game_item(room_id), room)
    mutated = False
    if _should_lazy_start_gomoku(room, game):
        game = _mutate_game(room, lambda g: _force_start_gomoku_for_room(g, room))
        mutated = True
        room = _get_gomoku_room(room_id)
    if game.get("phase") == "playing" and room.get("status") == "setup":
        _mark_room_playing(room_id)
        room = _get_gomoku_room(room_id)
        mutated = True
    if mutated:
        _broadcast_game_state(game, room, path_room_id)
    return response(200, _viewer_state(game, room, player_id, path_room_id))


def player_ready(event, room_id, path_room_id):
    body = json.loads(event.get("body") or "{}")
    player_id = body.get("playerId")
    player_token = body.get("playerToken")

    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken are required"})

    try:
        room = _get_gomoku_room(room_id)
        _require_room_player(room, player_id, player_token)
        game = _mutate_game(room, lambda current: _apply_ready(current, room, player_id))
    except ValueError as exc:
        return _error_response(str(exc))

    if game["phase"] == "playing":
        _mark_room_playing(room_id)
        room = _get_gomoku_room(room_id)

    _broadcast_game_state(game, room, path_room_id)
    return response(200, _viewer_state(game, room, player_id, path_room_id))


def place_stone(event, room_id, path_room_id):
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
        room = _get_gomoku_room(room_id)
        _require_room_player(room, player_id, player_token)
        game = _mutate_game(room, lambda current: _apply_place(current, player_id, row, col))
    except ValueError as exc:
        return _error_response(str(exc))

    if game["phase"] == "finished":
        _mark_room_finished(room_id)
        room = _get_gomoku_room(room_id)

    _broadcast_game_state(game, room, path_room_id)
    return response(200, _viewer_state(game, room, player_id, path_room_id))


def forfeit_game(event, room_id, path_room_id):
    body = json.loads(event.get("body") or "{}")
    player_id = body.get("playerId")
    player_token = body.get("playerToken")

    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken are required"})

    try:
        room = _get_gomoku_room(room_id)
        _require_room_player(room, player_id, player_token)
    except ValueError as exc:
        return _error_response(str(exc))

    dynamodb.Table(GOMOKU_TABLE).delete_item(Key={"roomId": room_id})
    _reset_room_to_waiting(room_id)

    _broadcast_room_event(room_id, {"type": "ROOM_UPDATED", "roomId": room_id, "status": "waiting"})
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
        "body": json.dumps(body, default=_json_default),
    }


def _error_response(message):
    if message == "Room not found":
        return response(404, {"error": message})
    if message == "Invalid player credentials for this room":
        return response(403, {"error": message})
    return response(400, {"error": message})


def _promote_gomoku_to_playing_if_all_ready(game, room):
    player_ids = [p["playerId"] for p in room.get("players", [])]
    if len(player_ids) < 2 or not all(game["players"].get(pid, {}).get("ready") for pid in player_ids):
        return game
    shuffled = player_ids[:]
    random.shuffle(shuffled)
    black_player = shuffled[0]
    white_player = shuffled[1]
    game["colorAssignment"] = {black_player: "black", white_player: "white"}
    for pid in player_ids:
        game["players"][pid]["color"] = game["colorAssignment"][pid]
    game["playerOrder"] = [black_player, white_player]
    game["currentTurnPlayerId"] = black_player
    game["phase"] = "playing"
    return game


def _should_lazy_start_gomoku(room, game):
    if room.get("status") not in ("setup", "playing"):
        return False
    if len(room.get("players", [])) < 2:
        return False
    return game.get("phase") == "waiting_for_players"


def _force_start_gomoku_for_room(game, room):
    if game["phase"] == "playing":
        return game
    if game["phase"] != "waiting_for_players":
        return game
    player_ids = [p["playerId"] for p in room.get("players", [])]
    if len(player_ids) < 2:
        return game
    for pid in player_ids:
        game["players"][pid]["ready"] = True
    return _promote_gomoku_to_playing_if_all_ready(game, room)


def _apply_ready(game, room, player_id):
    player_ids = [p["playerId"] for p in room.get("players", [])]
    if len(player_ids) < 2:
        raise ValueError("Not enough players to start")
    if game["phase"] not in ("waiting_for_players",):
        raise ValueError("Game is already in progress")

    game["players"][player_id]["ready"] = True
    return _promote_gomoku_to_playing_if_all_ready(game, room)


def _apply_place(game, player_id, row, col):
    if game["phase"] != "playing":
        raise ValueError("Game is not in playing phase")
    if game.get("winnerPlayerId"):
        raise ValueError("Game is already finished")
    if game.get("currentTurnPlayerId") != player_id:
        raise ValueError("It is not your turn")
    if not (0 <= row < BOARD_SIZE and 0 <= col < BOARD_SIZE):
        raise ValueError("Coordinates must be between 0 and 14")

    board = game["board"]
    if int(board[row][col]) != 0:
        raise ValueError("That cell is already occupied")

    color_value = 1 if game["colorAssignment"].get(player_id) == "black" else 2
    board[row][col] = color_value

    total_moves = int(game.get("totalMoves", 0)) + 1
    game["totalMoves"] = total_moves
    game["moveHistory"].append({
        "moveNumber": total_moves,
        "row": row,
        "col": col,
        "color": game["colorAssignment"].get(player_id),
        "playerId": player_id,
        "timestamp": _now(),
    })

    winning_cells = _check_winner(board, row, col, color_value)
    if winning_cells:
        game["winnerPlayerId"] = player_id
        game["winningCells"] = winning_cells
        game["phase"] = "finished"
        game["currentTurnPlayerId"] = None
    elif total_moves >= BOARD_SIZE * BOARD_SIZE:
        game["winnerPlayerId"] = DRAW_RESULT
        game["phase"] = "finished"
        game["currentTurnPlayerId"] = None
    else:
        player_order = game.get("playerOrder", [])
        opponent_id = next((pid for pid in player_order if pid != player_id), None)
        game["currentTurnPlayerId"] = opponent_id

    return game


def _check_winner(board, row, col, color_value):
    for dr, dc in DIRECTIONS:
        cells = [(row, col)]
        for sign in (1, -1):
            r, c = row + dr * sign, col + dc * sign
            while 0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE and int(board[r][c]) == color_value:
                cells.append((r, c))
                r += dr * sign
                c += dc * sign
        if len(cells) >= WIN_LENGTH:
            return [f"{r},{c}" for r, c in cells]
    return None


def _mutate_game(room, mutate_fn):
    table = dynamodb.Table(GOMOKU_TABLE)

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
    current_players = game.get("players", {})

    game["players"] = {}
    for rp in room_players:
        pid = rp["playerId"]
        ps = _deep_copy(current_players[pid]) if current_players.get(pid) else {}
        ps.setdefault("ready", False)
        ps.setdefault("color", None)
        ps["playerName"] = rp.get("playerName")
        game["players"][pid] = ps

    if not game.get("playerOrder"):
        game["playerOrder"] = [p["playerId"] for p in room_players]

    return game


def _default_game_state(room):
    now = _now()
    return {
        "roomId": room["roomId"],
        "createdAt": now,
        "updatedAt": now,
        "phase": "waiting_for_players",
        "board": [[0] * BOARD_SIZE for _ in range(BOARD_SIZE)],
        "colorAssignment": {},
        "playerOrder": [p["playerId"] for p in room.get("players", [])],
        "players": {
            p["playerId"]: {"playerName": p.get("playerName"), "ready": False, "color": None}
            for p in room.get("players", [])
        },
        "currentTurnPlayerId": None,
        "moveHistory": [],
        "winnerPlayerId": None,
        "winningCells": None,
        "totalMoves": 0,
    }


def _viewer_state(game, room, viewer_player_id, path_room_id):
    color_assignment = game.get("colorAssignment", {})
    your_color = color_assignment.get(viewer_player_id)
    current_turn = game.get("currentTurnPlayerId")
    player_ids = [p["playerId"] for p in room.get("players", [])]
    my_player = game["players"].get(viewer_player_id, {})

    return {
        "roomId": _numeric_room_for_api(path_room_id, room),
        "gameType": "gomoku",
        "phase": game.get("phase", "waiting_for_players"),
        "board": [[int(cell) if cell else 0 for cell in row] for row in game.get("board", [])],
        "yourColor": your_color,
        "yourTurn": current_turn == viewer_player_id,
        "yourReady": my_player.get("ready", False),
        "currentTurnPlayerId": current_turn,
        "moveHistory": game.get("moveHistory", []),
        "winnerPlayerId": game.get("winnerPlayerId"),
        "winningCells": game.get("winningCells"),
        "totalMoves": int(game.get("totalMoves", 0)),
        "allPlayersJoined": len(player_ids) >= 2,
        "players": [
            {
                "playerId": p["playerId"],
                "playerName": p.get("playerName"),
                "color": game["players"].get(p["playerId"], {}).get("color"),
                "ready": game["players"].get(p["playerId"], {}).get("ready", False),
            }
            for p in room.get("players", [])
        ],
        "hostPlayerId": _current_host_player_id(room),
        "hostPlayerName": _current_host_player_name(room),
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


def _broadcast_room_event(room_id, message):
    payload = json.dumps(message, default=_json_default).encode()
    for connection in _get_room_connection_records(room_id):
        try:
            apigw.post_to_connection(ConnectionId=connection["connectionId"], Data=payload)
        except apigw.exceptions.GoneException:
            dynamodb.Table(CONNECTIONS_TABLE).delete_item(Key={"connectionId": connection["connectionId"]})
        except Exception:
            pass


def _get_gomoku_room(room_id):
    room = dynamodb.Table(ROOMS_TABLE).get_item(Key={"roomId": room_id}).get("Item")
    if not room:
        raise ValueError("Room not found")
    if room.get("gameType") != "gomoku":
        raise ValueError("Room is not a gomoku room")
    return room


def _require_room_player(room, player_id, player_token):
    for player in room.get("players", []):
        if player["playerId"] == player_id and player.get("playerToken") == player_token:
            return player
    raise ValueError("Invalid player credentials for this room")


def _get_game_item(room_id):
    return dynamodb.Table(GOMOKU_TABLE).get_item(Key={"roomId": room_id}).get("Item")


def _get_room_connection_records(room_id):
    conn_table = dynamodb.Table(CONNECTIONS_TABLE)
    result = conn_table.query(
        IndexName="roomId-index",
        KeyConditionExpression=boto3.dynamodb.conditions.Key("roomId").eq(room_id),
    )
    records = []
    for item in result.get("Items", []):
        connection = conn_table.get_item(Key={"connectionId": item["connectionId"]}).get("Item")
        if connection:
            records.append(connection)
    return records


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
    ttl = int(datetime.now(timezone.utc).timestamp()) + WAITING_ROOM_TTL_HOURS * 3600
    dynamodb.Table(ROOMS_TABLE).update_item(
        Key={"roomId": room_id},
        UpdateExpression="SET #status = :waiting, updatedAt = :updatedAt, expiresAt = :ttl",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={":waiting": "waiting", ":updatedAt": _now(), ":ttl": ttl},
    )


def _deep_copy(value):
    return json.loads(json.dumps(value, default=_json_default))


def _json_default(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj == int(obj) else float(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def _now():
    return datetime.now(timezone.utc).isoformat()
