import json
import os
import random
from datetime import datetime, timezone
from decimal import Decimal

import boto3
import chess
from botocore.exceptions import ClientError

dynamodb = boto3.resource("dynamodb")
ROOMS_TABLE = os.environ["ROOMS_TABLE"]
CONNECTIONS_TABLE = os.environ["CONNECTIONS_TABLE"]
CHESS_TABLE = os.environ["CHESS_TABLE"]
WS_ENDPOINT = os.environ["WS_ENDPOINT"]

apigw = boto3.client("apigatewaymanagementapi", endpoint_url=WS_ENDPOINT)

INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
DRAW_RESULT = "DRAW"


def _storage_room_id(path_room_id):
    if not path_room_id:
        return path_room_id
    if "#" in path_room_id:
        return path_room_id
    return f"chess#{path_room_id}"


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
    if http_method == "POST" and room_id and path.endswith("/move"):
        return make_move(event, room_id, path_room_id)
    if http_method == "POST" and room_id and path.endswith("/draw"):
        return handle_draw(event, room_id, path_room_id)
    if http_method == "POST" and room_id and path.endswith("/resign"):
        return resign(event, room_id, path_room_id)
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
        room = _get_chess_room(room_id)
        _require_room_player(room, player_id, player_token)
    except ValueError as exc:
        return _error_response(str(exc))

    game = _prepare_game_state(_get_game_item(room_id), room)
    mutated = False
    if _should_lazy_start_chess(room, game):
        game = _mutate_game(room, lambda g: _force_start_chess_for_room(g, room))
        mutated = True
        room = _get_chess_room(room_id)
    if game.get("phase") == "playing" and room.get("status") == "setup":
        _mark_room_playing(room_id)
        room = _get_chess_room(room_id)
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
        room = _get_chess_room(room_id)
        _require_room_player(room, player_id, player_token)
        game = _mutate_game(room, lambda current: _apply_ready(current, room, player_id))
    except ValueError as exc:
        return _error_response(str(exc))

    if game["phase"] == "playing":
        _mark_room_playing(room_id)
        room = _get_chess_room(room_id)

    _broadcast_game_state(game, room, path_room_id)
    return response(200, _viewer_state(game, room, player_id, path_room_id))


def make_move(event, room_id, path_room_id):
    body = json.loads(event.get("body") or "{}")
    player_id = body.get("playerId")
    player_token = body.get("playerToken")
    from_sq = body.get("from")
    to_sq = body.get("to")
    promotion = body.get("promotion")

    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken are required"})
    if not from_sq or not to_sq:
        return response(400, {"error": "from and to squares are required"})

    try:
        room = _get_chess_room(room_id)
        _require_room_player(room, player_id, player_token)
        game = _mutate_game(room, lambda current: _apply_move(current, player_id, from_sq, to_sq, promotion))
    except ValueError as exc:
        return _error_response(str(exc))

    if game["phase"] == "finished":
        _mark_room_finished(room_id)
        room = _get_chess_room(room_id)

    _broadcast_game_state(game, room, path_room_id)
    return response(200, _viewer_state(game, room, player_id, path_room_id))


def handle_draw(event, room_id, path_room_id):
    body = json.loads(event.get("body") or "{}")
    player_id = body.get("playerId")
    player_token = body.get("playerToken")
    action = body.get("action")

    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken are required"})
    if action not in ("offer", "accept", "decline"):
        return response(400, {"error": "action must be offer, accept, or decline"})

    try:
        room = _get_chess_room(room_id)
        _require_room_player(room, player_id, player_token)
        game = _mutate_game(room, lambda current: _apply_draw(current, player_id, action))
    except ValueError as exc:
        return _error_response(str(exc))

    if game["phase"] == "finished":
        _mark_room_finished(room_id)
        room = _get_chess_room(room_id)

    _broadcast_game_state(game, room, path_room_id)
    return response(200, _viewer_state(game, room, player_id, path_room_id))


def resign(event, room_id, path_room_id):
    body = json.loads(event.get("body") or "{}")
    player_id = body.get("playerId")
    player_token = body.get("playerToken")

    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken are required"})

    try:
        room = _get_chess_room(room_id)
        _require_room_player(room, player_id, player_token)
        game = _mutate_game(room, lambda current: _apply_resign(current, room, player_id))
    except ValueError as exc:
        return _error_response(str(exc))

    _mark_room_finished(room_id)
    room = _get_chess_room(room_id)
    _broadcast_game_state(game, room, path_room_id)
    return response(200, {"roomId": path_room_id, "winnerPlayerId": game["winnerPlayerId"], "phase": "finished"})


def forfeit_game(event, room_id, path_room_id):
    """Clear a finished match and return the room to waiting (lobby), like other games' forfeit."""
    body = json.loads(event.get("body") or "{}")
    player_id = body.get("playerId")
    player_token = body.get("playerToken")

    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken are required"})

    try:
        room = _get_chess_room(room_id)
        _require_room_player(room, player_id, player_token)
    except ValueError as exc:
        return _error_response(str(exc))

    existing = _get_game_item(room_id)
    if existing and existing.get("phase") != "finished":
        return response(400, {"error": "Finish or resign the game before leaving the match"})

    dynamodb.Table(CHESS_TABLE).delete_item(Key={"roomId": room_id})
    _reset_room_to_waiting(room_id)

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
        "body": json.dumps(body, default=_json_default),
    }


def _error_response(message):
    if message == "Room not found":
        return response(404, {"error": message})
    if message == "Invalid player credentials for this room":
        return response(403, {"error": message})
    return response(400, {"error": message})


def _promote_chess_to_playing_if_all_ready(game, room):
    player_ids = [p["playerId"] for p in room.get("players", [])]
    if len(player_ids) < 2 or not all(game["players"].get(pid, {}).get("ready") for pid in player_ids):
        return game
    shuffled = player_ids[:]
    random.shuffle(shuffled)
    game["colorAssignment"] = {shuffled[0]: "white", shuffled[1]: "black"}
    for pid in player_ids:
        game["players"][pid]["color"] = game["colorAssignment"][pid]
    game["playerOrder"] = [shuffled[0], shuffled[1]]
    game["phase"] = "playing"
    return game


def _should_lazy_start_chess(room, game):
    if room.get("status") not in ("setup", "playing"):
        return False
    if len(room.get("players", [])) < 2:
        return False
    return game.get("phase") in ("waiting_for_players", "setup")


def _force_start_chess_for_room(game, room):
    if game["phase"] == "playing":
        return game
    if game["phase"] not in ("waiting_for_players", "setup"):
        return game
    player_ids = [p["playerId"] for p in room.get("players", [])]
    if len(player_ids) < 2:
        return game
    for pid in player_ids:
        game["players"][pid]["ready"] = True
    return _promote_chess_to_playing_if_all_ready(game, room)


def _apply_ready(game, room, player_id):
    if game["phase"] not in ("waiting_for_players", "setup"):
        raise ValueError("Game is not in setup phase")

    game["players"][player_id]["ready"] = True
    return _promote_chess_to_playing_if_all_ready(game, room)


def _apply_move(game, player_id, from_sq, to_sq, promotion):
    if game["phase"] != "playing":
        raise ValueError("Game is not in playing phase")
    if game.get("winnerPlayerId"):
        raise ValueError("Game is already finished")

    color_assignment = game.get("colorAssignment", {})
    player_color = color_assignment.get(player_id)
    if not player_color:
        raise ValueError("It is not your turn")

    board = chess.Board(game["fen"])
    is_white_turn = board.turn == chess.WHITE
    if is_white_turn and player_color != "white":
        raise ValueError("It is not your turn")
    if not is_white_turn and player_color != "black":
        raise ValueError("It is not your turn")

    try:
        from_square = chess.parse_square(from_sq)
        to_square = chess.parse_square(to_sq)
    except (ValueError, AttributeError):
        raise ValueError("Invalid square notation")

    piece = board.piece_at(from_square)
    needs_promotion = (
        piece and
        piece.piece_type == chess.PAWN and
        (
            (piece.color == chess.WHITE and chess.square_rank(to_square) == 7) or
            (piece.color == chess.BLACK and chess.square_rank(to_square) == 0)
        )
    )

    if needs_promotion and not promotion:
        raise ValueError("Pawn promotion required: provide promotion piece (q/r/b/n)")
    if promotion and promotion not in ("q", "r", "b", "n"):
        raise ValueError("promotion must be q, r, b, or n")

    uci = from_sq + to_sq + (promotion or "")
    try:
        move = chess.Move.from_uci(uci)
    except chess.InvalidMoveError:
        raise ValueError("Invalid move format")

    if move not in board.legal_moves:
        raise ValueError("Illegal move")

    san = board.san(move)
    board.push(move)
    new_fen = board.fen()
    ply = len(game["moveHistory"]) + 1

    game["moveHistory"].append({
        "ply": ply,
        "uci": str(move),
        "san": san,
        "fenAfter": new_fen,
        "playerId": player_id,
        "timestamp": _now(),
    })
    game["fen"] = new_fen
    game["drawOfferedBy"] = None

    if board.is_game_over():
        outcome = board.outcome()
        if outcome.winner is None:
            game["winnerPlayerId"] = DRAW_RESULT
        else:
            winning_color = "white" if outcome.winner == chess.WHITE else "black"
            for pid, color in color_assignment.items():
                if color == winning_color:
                    game["winnerPlayerId"] = pid
                    break
        game["phase"] = "finished"

    return game


def _apply_draw(game, player_id, action):
    if game["phase"] != "playing":
        raise ValueError("Game is not in playing phase")

    if action == "offer":
        game["drawOfferedBy"] = player_id
    elif action == "accept":
        if not game.get("drawOfferedBy"):
            raise ValueError("No draw offer to accept")
        if game["drawOfferedBy"] == player_id:
            raise ValueError("Cannot accept your own draw offer")
        game["winnerPlayerId"] = DRAW_RESULT
        game["phase"] = "finished"
        game["drawOfferedBy"] = None
    elif action == "decline":
        if not game.get("drawOfferedBy"):
            raise ValueError("No draw offer to decline")
        if game["drawOfferedBy"] == player_id:
            raise ValueError("Cannot decline your own draw offer")
        game["drawOfferedBy"] = None

    return game


def _apply_resign(game, room, player_id):
    if game["phase"] not in ("playing", "setup"):
        raise ValueError("Game is not in progress")

    player_ids = [p["playerId"] for p in room.get("players", [])]
    opponent_id = next((pid for pid in player_ids if pid != player_id), None)
    if not opponent_id:
        raise ValueError("No opponent found")

    game["winnerPlayerId"] = opponent_id
    game["phase"] = "finished"
    return game


def _mutate_game(room, mutate_fn):
    table = dynamodb.Table(CHESS_TABLE)

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

    if not game.get("phase") or game["phase"] == "waiting_for_players":
        room_status = room.get("status", "waiting")
        game["phase"] = "setup" if room_status == "setup" else "waiting_for_players"

    return game


def _default_game_state(room):
    now = _now()
    room_status = room.get("status", "waiting")
    return {
        "roomId": room["roomId"],
        "createdAt": now,
        "updatedAt": now,
        "phase": "setup" if room_status == "setup" else "waiting_for_players",
        "fen": INITIAL_FEN,
        "colorAssignment": {},
        "playerOrder": [p["playerId"] for p in room.get("players", [])],
        "players": {
            p["playerId"]: {"playerName": p.get("playerName"), "ready": False, "color": None}
            for p in room.get("players", [])
        },
        "moveHistory": [],
        "winnerPlayerId": None,
        "drawOfferedBy": None,
    }


def _viewer_state(game, room, viewer_player_id, path_room_id):
    color_assignment = game.get("colorAssignment", {})
    your_color = color_assignment.get(viewer_player_id)

    your_turn = False
    if game.get("phase") == "playing" and not game.get("winnerPlayerId"):
        board = chess.Board(game.get("fen", INITIAL_FEN))
        is_white_turn = board.turn == chess.WHITE
        if (is_white_turn and your_color == "white") or (not is_white_turn and your_color == "black"):
            your_turn = True

    draw_offered_by = game.get("drawOfferedBy")

    return {
        "roomId": _numeric_room_for_api(path_room_id, room),
        "gameType": "chess",
        "phase": game.get("phase", "waiting_for_players"),
        "fen": game.get("fen", INITIAL_FEN),
        "yourColor": your_color,
        "yourTurn": your_turn,
        "moveHistory": [
            {"ply": m["ply"], "san": m["san"], "playerId": m["playerId"], "timestamp": m["timestamp"]}
            for m in game.get("moveHistory", [])
        ],
        "winnerPlayerId": game.get("winnerPlayerId"),
        "drawOfferedBy": draw_offered_by,
        "opponentOfferedDraw": bool(draw_offered_by and draw_offered_by != viewer_player_id),
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


def _get_chess_room(room_id):
    room = dynamodb.Table(ROOMS_TABLE).get_item(Key={"roomId": room_id}).get("Item")
    if not room:
        raise ValueError("Room not found")
    if room.get("gameType") != "chess":
        raise ValueError("Room is not a chess room")
    return room


def _require_room_player(room, player_id, player_token):
    for player in room.get("players", []):
        if player["playerId"] == player_id and player.get("playerToken") == player_token:
            return player
    raise ValueError("Invalid player credentials for this room")


def _get_game_item(room_id):
    return dynamodb.Table(CHESS_TABLE).get_item(Key={"roomId": room_id}).get("Item")


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
    ttl = int(datetime.now(timezone.utc).timestamp()) + 86400
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
