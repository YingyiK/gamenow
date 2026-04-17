import json
import os
import random
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource("dynamodb")
ROOMS_TABLE = os.environ["ROOMS_TABLE"]
CONNECTIONS_TABLE = os.environ["CONNECTIONS_TABLE"]
WS_ENDPOINT = os.environ["WS_ENDPOINT"]

WAITING_ROOM_TTL_HOURS = 24
ROOM_ID_MIN = 1000
ROOM_ID_MAX = 9999
ROOM_ID_ATTEMPTS = 25

apigw = boto3.client("apigatewaymanagementapi", endpoint_url=WS_ENDPOINT)


def lambda_handler(event, context):
    http_method = event.get("httpMethod", "")
    resource = (event.get("resource") or "").strip()
    pp = event.get("pathParameters") or {}

    if http_method == "POST" and resource == "/rooms":
        return create_room(event)

    storage_id = _storage_room_id_from_path_params(pp)
    if storage_id is None and (pp.get("gameType") or pp.get("numericRoomId")):
        return response(400, {"error": "Invalid gameType or room code"})

    if http_method == "GET" and resource == "/rooms/by-code/{gameType}/{numericRoomId}" and storage_id:
        return get_room(storage_id)
    if http_method == "POST" and resource == "/rooms/by-code/{gameType}/{numericRoomId}/start" and storage_id:
        return start_room(event, storage_id)
    if http_method == "POST" and resource == "/rooms/by-code/{gameType}/{numericRoomId}/join" and storage_id:
        return join_room(event, storage_id)
    if http_method == "POST" and resource == "/rooms/by-code/{gameType}/{numericRoomId}/leave" and storage_id:
        return leave_room(event, storage_id)
    return response(404, {"error": "Route not found"})


def create_room(event):
    body = json.loads(event.get("body") or "{}")
    game_type = body.get("gameType")
    player_name = _validate_player_name(body.get("playerName"))
    if not player_name:
        return response(400, {"error": "playerName is required"})
    if game_type not in ("uno", "battleship", "chess", "gomoku"):
        return response(400, {"error": "gameType must be uno, battleship, chess, or gomoku"})

    raw_rid = body.get("roomId")
    if raw_rid is not None and raw_rid != "":
        requested = _optional_room_id_from_body(raw_rid)
        if requested is None:
            return response(400, {"error": "roomId must be a 4-digit number between 1000 and 9999"})
    else:
        requested = None

    table = dynamodb.Table(ROOMS_TABLE)
    player = _new_player(player_name)
    now = _now()

    if requested is not None:
        storage_id = _compose_storage_room_id(game_type, requested)
        item = {
            "roomId": storage_id,
            "gameType": game_type,
            "status": "waiting",
            "players": [player],
            "createdAt": now,
            "updatedAt": now,
            "expiresAt": _waiting_room_expires_at(),
        }
        try:
            table.put_item(Item=item, ConditionExpression="attribute_not_exists(roomId)")
            return response(201, _session_response(storage_id, player, game_type, "waiting", player["playerId"]))
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return response(409, {"error": "Room already exists"})
            raise

    for _ in range(ROOM_ID_ATTEMPTS):
        room_id = _generate_room_id()
        storage_id = _compose_storage_room_id(game_type, room_id)
        try:
            table.put_item(
                Item={
                    "roomId": storage_id,
                    "gameType": game_type,
                    "status": "waiting",
                    "players": [player],
                    "createdAt": now,
                    "updatedAt": now,
                    "expiresAt": _waiting_room_expires_at(),
                },
                ConditionExpression="attribute_not_exists(roomId)",
            )
            return response(201, _session_response(storage_id, player, game_type, "waiting", player["playerId"]))
        except ClientError as exc:
            if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise

    return response(409, {"error": "Could not allocate a room ID, please try again"})


def get_room(room_id):
    item = dynamodb.Table(ROOMS_TABLE).get_item(Key={"roomId": room_id}).get("Item")
    if not item:
        return response(404, {"error": "Room not found"})
    return response(200, _public_room(item))


def join_room(event, room_id):
    body = json.loads(event.get("body") or "{}")
    player_name = _validate_player_name(body.get("playerName"))
    if not player_name:
        return response(400, {"error": "playerName is required"})

    table = dynamodb.Table(ROOMS_TABLE)
    item = table.get_item(Key={"roomId": room_id}).get("Item")
    if not item:
        return response(404, {"error": "Room not found"})
    if item["status"] != "waiting":
        return response(400, {"error": "Room is not accepting players"})

    max_players = _max_players(item["gameType"])
    if len(item["players"]) >= max_players:
        return response(400, {"error": "Room is full"})

    player = _new_player(player_name)
    now = _now()
    try:
        table.update_item(
            Key={"roomId": room_id},
            UpdateExpression="SET players = list_append(players, :players), updatedAt = :updatedAt",
            ConditionExpression="attribute_exists(roomId) AND #status = :waiting AND size(players) < :maxPlayers",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":players": [player],
                ":updatedAt": now,
                ":waiting": "waiting",
                ":maxPlayers": max_players,
            },
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise

        latest = table.get_item(Key={"roomId": room_id}).get("Item")
        if not latest:
            return response(404, {"error": "Room not found"})
        if latest["status"] != "waiting":
            return response(400, {"error": "Room is not accepting players"})
        return response(400, {"error": "Room is full"})

    return response(200, _session_response(room_id, player, item["gameType"], item["status"], _current_host_player_id(item)))


def start_room(event, room_id):
    body = json.loads(event.get("body") or "{}")
    player_id = body.get("playerId")
    player_token = body.get("playerToken")
    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken required"})

    table = dynamodb.Table(ROOMS_TABLE)
    for _ in range(3):
        item = table.get_item(Key={"roomId": room_id}).get("Item")
        if not item:
            return response(404, {"error": "Room not found"})
        if item.get("gameType") not in ("battleship", "chess", "gomoku"):
            return response(400, {"error": "Only battleship, chess, and gomoku rooms support explicit start"})
        if item.get("status") != "waiting":
            return response(400, {"error": "Room has already started"})

        requester = _get_room_player(item, player_id, player_token)
        if not requester:
            return response(403, {"error": "Invalid player credentials for this room"})

        current_host_player_id = _current_host_player_id(item)
        if player_id != current_host_player_id:
            return response(403, {"error": "Only the host can start the game"})

        max_players = _max_players(item["gameType"])
        if len(item.get("players", [])) < max_players:
            return response(400, {"error": "All seats must be filled before starting"})

        try:
            table.update_item(
                Key={"roomId": room_id},
                UpdateExpression="SET #status = :status, updatedAt = :updatedAt REMOVE expiresAt",
                ConditionExpression="attribute_exists(roomId) AND updatedAt = :expectedUpdatedAt AND #status = :waiting",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={
                    ":status": "setup",
                    ":updatedAt": _now(),
                    ":expectedUpdatedAt": item["updatedAt"],
                    ":waiting": "waiting",
                },
            )
            _broadcast_room_event(room_id, {
                "type": "ROOM_STARTED",
                "roomId": room_id,
                "hostPlayerId": player_id,
                "status": "setup",
            })
            return response(200, {
                "roomId": room_id,
                "status": "setup",
                "hostPlayerId": current_host_player_id,
                "hostPlayerName": _current_host_player_name(item),
            })
        except ClientError as exc:
            if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise

    return response(409, {"error": "Room changed while updating, please retry"})


def leave_room(event, room_id):
    body = json.loads(event.get("body") or "{}")
    player_id = body.get("playerId")
    player_token = body.get("playerToken")
    target_player_id = body.get("targetPlayerId") or player_id

    if not player_id or not player_token:
        return response(400, {"error": "playerId and playerToken required"})

    table = dynamodb.Table(ROOMS_TABLE)
    for _ in range(3):
        item = table.get_item(Key={"roomId": room_id}).get("Item")
        if not item:
            return response(404, {"error": "Room not found"})

        requester = _get_room_player(item, player_id, player_token)
        if not requester:
            return response(403, {"error": "Invalid player credentials for this room"})

        target = _get_room_player(item, target_player_id)
        if not target:
            return response(404, {"error": "Target player not found in room"})

        current_host_player_id = _current_host_player_id(item)
        if target_player_id != player_id and player_id != current_host_player_id:
            return response(403, {"error": "Only the host can remove other players"})

        remaining_players = [player for player in item.get("players", []) if player["playerId"] != target_player_id]
        next_status = item["status"]
        update_expression = "SET players = :players, updatedAt = :updatedAt"
        expression_values = {
            ":players": remaining_players,
            ":updatedAt": _now(),
            ":expectedUpdatedAt": item["updatedAt"],
        }
        if item["status"] == "setup":
            next_status = "waiting"
            update_expression = "SET players = :players, updatedAt = :updatedAt, #status = :status, expiresAt = :expiresAt"
            expression_values[":status"] = "waiting"
            expression_values[":expiresAt"] = _waiting_room_expires_at()
        try:
            update_kwargs = {
                "Key": {"roomId": room_id},
                "UpdateExpression": update_expression,
                "ConditionExpression": "attribute_exists(roomId) AND updatedAt = :expectedUpdatedAt",
                "ExpressionAttributeValues": expression_values,
            }
            if item["status"] == "setup":
                update_kwargs["ExpressionAttributeNames"] = {"#status": "status"}
            table.update_item(**update_kwargs)
            _close_player_connections(room_id, target_player_id)
            _broadcast_room_event(room_id, {
                "type": "ROOM_UPDATED",
                "roomId": room_id,
                "status": next_status,
                "hostPlayerId": _current_host_player_id_from_players(remaining_players),
            })
            return response(200, {
                "roomId": room_id,
                "removedPlayerId": target_player_id,
                "removedPlayerName": target.get("playerName"),
                "hostPlayerId": _current_host_player_id_from_players(remaining_players),
                "hostPlayerName": _current_host_player_name_from_players(remaining_players),
                "status": next_status,
            })
        except ClientError as exc:
            if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise

    return response(409, {"error": "Room changed while updating, please retry"})


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


def _session_response(room_id, player, game_type, status, host_player_id):
    return {
        "roomId": room_id,
        "playerId": player["playerId"],
        "playerToken": player["playerToken"],
        "playerName": player["playerName"],
        "hostPlayerId": host_player_id,
        "gameType": game_type,
        "status": status,
    }


def _new_player(player_name):
    return {
        "playerId": str(uuid.uuid4()),
        "playerToken": secrets.token_urlsafe(24),
        "playerName": player_name,
        "joinedAt": _now(),
    }


def _validate_player_name(player_name):
    if not isinstance(player_name, str):
        return None
    player_name = player_name.strip()
    if not player_name:
        return None
    return player_name[:24]


def _compose_storage_room_id(game_type, numeric_room_id):
    """DynamoDB partition key: battleship#7089 (per-game room numbers)."""
    return f"{game_type}#{numeric_room_id}"


def _storage_room_id_from_path_params(pp):
    game_type = pp.get("gameType")
    numeric = pp.get("numericRoomId")
    if not game_type or not numeric:
        return None
    padded = _optional_room_id_from_body(numeric)
    if padded is None or game_type not in ("uno", "battleship", "chess", "gomoku"):
        return None
    return _compose_storage_room_id(game_type, padded)


def _optional_room_id_from_body(raw):
    """If client requests a fixed 4-digit room id (1000–9999), return zero-padded str; else None."""
    if raw is None or raw is False:
        return None
    if isinstance(raw, bool):
        return None
    s = str(raw).strip()
    if not s.isdigit():
        return None
    n = int(s)
    if n < ROOM_ID_MIN or n > ROOM_ID_MAX:
        return None
    return f"{n:04d}"


def _generate_room_id():
    return f"{random.randint(ROOM_ID_MIN, ROOM_ID_MAX):04d}"


def _public_room(item):
    public_item = dict(item)
    public_item["players"] = [_public_player(player) for player in item.get("players", [])]
    public_item["hostPlayerId"] = _current_host_player_id(item)
    public_item["hostPlayerName"] = _current_host_player_name(item)
    return public_item


def _public_player(player):
    return {
        "playerId": player["playerId"],
        "playerName": player.get("playerName"),
        "joinedAt": player["joinedAt"],
    }


def _max_players(game_type):
    return {"uno": 4, "battleship": 2, "chess": 2, "gomoku": 2}[game_type]


def _waiting_room_expires_at():
    expires_at = datetime.now(timezone.utc) + timedelta(hours=WAITING_ROOM_TTL_HOURS)
    return int(expires_at.timestamp())


def _current_host_player_id(room):
    return _current_host_player_id_from_players(room.get("players", []))


def _current_host_player_name(room):
    return _current_host_player_name_from_players(room.get("players", []))


def _current_host_player_id_from_players(players):
    return players[0]["playerId"] if players else None


def _current_host_player_name_from_players(players):
    return players[0].get("playerName") if players else None


def _get_room_player(room, player_id, player_token=None):
    for player in room.get("players", []):
        if player.get("playerId") != player_id:
            continue
        if player_token is not None and player.get("playerToken") != player_token:
            continue
        return player
    return None


def _close_player_connections(room_id, player_id):
    conn_table = dynamodb.Table(CONNECTIONS_TABLE)
    for item in _get_room_connection_items(room_id):
        connection_id = item["connectionId"]
        connection = conn_table.get_item(Key={"connectionId": connection_id}).get("Item", {})
        if connection.get("playerId") != player_id:
            continue
        try:
            apigw.delete_connection(ConnectionId=connection_id)
        except apigw.exceptions.GoneException:
            pass
        conn_table.delete_item(Key={"connectionId": connection_id})


def _broadcast_room_event(room_id, message):
    payload = json.dumps(message).encode()
    conn_table = dynamodb.Table(CONNECTIONS_TABLE)

    for item in _get_room_connection_items(room_id):
        connection_id = item["connectionId"]
        try:
            apigw.post_to_connection(ConnectionId=connection_id, Data=payload)
        except apigw.exceptions.GoneException:
            conn_table.delete_item(Key={"connectionId": connection_id})


def _get_room_connection_items(room_id):
    conn_table = dynamodb.Table(CONNECTIONS_TABLE)
    result = conn_table.query(
        IndexName="roomId-index",
        KeyConditionExpression=boto3.dynamodb.conditions.Key("roomId").eq(room_id),
    )
    return result.get("Items", [])


def _now():
    return datetime.now(timezone.utc).isoformat()
