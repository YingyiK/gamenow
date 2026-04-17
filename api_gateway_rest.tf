# ── REST API Gateway ─────────────────────────────────────────────────────────

resource "aws_api_gateway_rest_api" "rest" {
  name = "${var.project}-rest-api"
  tags = { Project = var.project }
}

# /rooms resource
resource "aws_api_gateway_resource" "rooms" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_rest_api.rest.root_resource_id
  path_part   = "rooms"
}

# POST /rooms
resource "aws_api_gateway_method" "post_rooms" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.rooms.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_rooms" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.rooms.id
  http_method             = aws_api_gateway_method.post_rooms.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.room_service.invoke_arn
}

resource "aws_api_gateway_method" "options_rooms" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.rooms.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_rooms" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.rooms.id
  http_method = aws_api_gateway_method.options_rooms.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "options_rooms" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.rooms.id
  http_method = aws_api_gateway_method.options_rooms.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_rooms" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.rooms.id
  http_method = aws_api_gateway_method.options_rooms.http_method
  status_code = aws_api_gateway_method_response.options_rooms.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# /rooms/by-code/{gameType}/{numericRoomId}
# Static "by-code" avoids API Gateway rule: only one variable path sibling under /rooms.
# If AWS still has an orphan /rooms/{roomId} from an older deploy, remove it with:
#   terraform output -raw rest_api_id | xargs -I{} python3 scripts/cleanup_legacy_room_ids.py apigw --rest-api-id {}
resource "aws_api_gateway_resource" "rooms_by_code" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.rooms.id
  path_part   = "by-code"
}

resource "aws_api_gateway_resource" "rooms_game_type" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.rooms_by_code.id
  path_part   = "{gameType}"
}

resource "aws_api_gateway_resource" "rooms_numeric_id" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.rooms_game_type.id
  path_part   = "{numericRoomId}"
}

# GET /rooms/by-code/{gameType}/{numericRoomId}
resource "aws_api_gateway_method" "get_room" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.rooms_numeric_id.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_room" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.rooms_numeric_id.id
  http_method             = aws_api_gateway_method.get_room.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.room_service.invoke_arn
}

resource "aws_api_gateway_method" "options_room" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.rooms_numeric_id.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.rooms_numeric_id.id
  http_method = aws_api_gateway_method.options_room.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "options_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.rooms_numeric_id.id
  http_method = aws_api_gateway_method.options_room.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.rooms_numeric_id.id
  http_method = aws_api_gateway_method.options_room.http_method
  status_code = aws_api_gateway_method_response.options_room.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,GET'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# /rooms/by-code/{gameType}/{numericRoomId}/join
resource "aws_api_gateway_resource" "join" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.rooms_numeric_id.id
  path_part   = "join"
}

resource "aws_api_gateway_resource" "leave" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.rooms_numeric_id.id
  path_part   = "leave"
}

resource "aws_api_gateway_resource" "start" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.rooms_numeric_id.id
  path_part   = "start"
}

resource "aws_api_gateway_resource" "battleship" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_rest_api.rest.root_resource_id
  path_part   = "battleship"
}

resource "aws_api_gateway_resource" "battleship_room_id" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.battleship.id
  path_part   = "{roomId}"
}

resource "aws_api_gateway_resource" "battleship_setup" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.battleship_room_id.id
  path_part   = "setup"
}

resource "aws_api_gateway_resource" "battleship_fire" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.battleship_room_id.id
  path_part   = "fire"
}

resource "aws_api_gateway_resource" "battleship_forfeit" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.battleship_room_id.id
  path_part   = "forfeit"
}

# POST /rooms/by-code/{gameType}/{numericRoomId}/join
resource "aws_api_gateway_method" "join_room" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.join.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "join_room" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.join.id
  http_method             = aws_api_gateway_method.join_room.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.room_service.invoke_arn
}

resource "aws_api_gateway_method" "leave_room" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.leave.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "leave_room" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.leave.id
  http_method             = aws_api_gateway_method.leave_room.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.room_service.invoke_arn
}

resource "aws_api_gateway_method" "start_room" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.start.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "start_room" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.start.id
  http_method             = aws_api_gateway_method.start_room.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.room_service.invoke_arn
}

resource "aws_api_gateway_method" "get_battleship_state" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.battleship_room_id.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_battleship_state" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.battleship_room_id.id
  http_method             = aws_api_gateway_method.get_battleship_state.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.battleship_service.invoke_arn
}

resource "aws_api_gateway_method" "post_battleship_setup" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.battleship_setup.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_battleship_setup" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.battleship_setup.id
  http_method             = aws_api_gateway_method.post_battleship_setup.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.battleship_service.invoke_arn
}

resource "aws_api_gateway_method" "post_battleship_fire" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.battleship_fire.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_battleship_fire" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.battleship_fire.id
  http_method             = aws_api_gateway_method.post_battleship_fire.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.battleship_service.invoke_arn
}

# POST /battleship/{roomId}/forfeit
resource "aws_api_gateway_method" "post_battleship_forfeit" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.battleship_forfeit.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_battleship_forfeit" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.battleship_forfeit.id
  http_method             = aws_api_gateway_method.post_battleship_forfeit.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.battleship_service.invoke_arn
}

resource "aws_api_gateway_method" "options_battleship_forfeit" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.battleship_forfeit.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_battleship_forfeit" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.battleship_forfeit.id
  http_method = aws_api_gateway_method.options_battleship_forfeit.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "options_battleship_forfeit" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.battleship_forfeit.id
  http_method = aws_api_gateway_method.options_battleship_forfeit.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_battleship_forfeit" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.battleship_forfeit.id
  http_method = aws_api_gateway_method.options_battleship_forfeit.http_method
  status_code = aws_api_gateway_method_response.options_battleship_forfeit.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

resource "aws_api_gateway_method" "options_join_room" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.join.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_join_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.join.id
  http_method = aws_api_gateway_method.options_join_room.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "options_join_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.join.id
  http_method = aws_api_gateway_method.options_join_room.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_join_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.join.id
  http_method = aws_api_gateway_method.options_join_room.http_method
  status_code = aws_api_gateway_method_response.options_join_room.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

resource "aws_api_gateway_method" "options_leave_room" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.leave.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_leave_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.leave.id
  http_method = aws_api_gateway_method.options_leave_room.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "options_leave_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.leave.id
  http_method = aws_api_gateway_method.options_leave_room.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_leave_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.leave.id
  http_method = aws_api_gateway_method.options_leave_room.http_method
  status_code = aws_api_gateway_method_response.options_leave_room.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

resource "aws_api_gateway_method" "options_start_room" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.start.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_start_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.start.id
  http_method = aws_api_gateway_method.options_start_room.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "options_start_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.start.id
  http_method = aws_api_gateway_method.options_start_room.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_start_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.start.id
  http_method = aws_api_gateway_method.options_start_room.http_method
  status_code = aws_api_gateway_method_response.options_start_room.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

resource "aws_api_gateway_method" "options_battleship_room" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.battleship_room_id.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_battleship_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.battleship_room_id.id
  http_method = aws_api_gateway_method.options_battleship_room.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "options_battleship_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.battleship_room_id.id
  http_method = aws_api_gateway_method.options_battleship_room.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_battleship_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.battleship_room_id.id
  http_method = aws_api_gateway_method.options_battleship_room.http_method
  status_code = aws_api_gateway_method_response.options_battleship_room.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,GET'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

resource "aws_api_gateway_method" "options_battleship_setup" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.battleship_setup.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_battleship_setup" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.battleship_setup.id
  http_method = aws_api_gateway_method.options_battleship_setup.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "options_battleship_setup" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.battleship_setup.id
  http_method = aws_api_gateway_method.options_battleship_setup.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_battleship_setup" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.battleship_setup.id
  http_method = aws_api_gateway_method.options_battleship_setup.http_method
  status_code = aws_api_gateway_method_response.options_battleship_setup.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

resource "aws_api_gateway_method" "options_battleship_fire" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.battleship_fire.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_battleship_fire" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.battleship_fire.id
  http_method = aws_api_gateway_method.options_battleship_fire.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "options_battleship_fire" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.battleship_fire.id
  http_method = aws_api_gateway_method.options_battleship_fire.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_battleship_fire" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.battleship_fire.id
  http_method = aws_api_gateway_method.options_battleship_fire.http_method
  status_code = aws_api_gateway_method_response.options_battleship_fire.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# ── Chess resources ───────────────────────────────────────────────────────────

resource "aws_api_gateway_resource" "chess" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_rest_api.rest.root_resource_id
  path_part   = "chess"
}

resource "aws_api_gateway_resource" "chess_room_id" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.chess.id
  path_part   = "{roomId}"
}

resource "aws_api_gateway_resource" "chess_ready" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.chess_room_id.id
  path_part   = "ready"
}

resource "aws_api_gateway_resource" "chess_move" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.chess_room_id.id
  path_part   = "move"
}

resource "aws_api_gateway_resource" "chess_draw" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.chess_room_id.id
  path_part   = "draw"
}

resource "aws_api_gateway_resource" "chess_resign" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.chess_room_id.id
  path_part   = "resign"
}

resource "aws_api_gateway_resource" "chess_forfeit" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.chess_room_id.id
  path_part   = "forfeit"
}

# GET /chess/{roomId}
resource "aws_api_gateway_method" "get_chess_state" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.chess_room_id.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_chess_state" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.chess_room_id.id
  http_method             = aws_api_gateway_method.get_chess_state.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.chess_service.invoke_arn
}

resource "aws_api_gateway_method" "options_chess_room" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.chess_room_id.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_chess_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_room_id.id
  http_method = aws_api_gateway_method.options_chess_room.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_chess_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_room_id.id
  http_method = aws_api_gateway_method.options_chess_room.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_chess_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_room_id.id
  http_method = aws_api_gateway_method.options_chess_room.http_method
  status_code = aws_api_gateway_method_response.options_chess_room.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,GET'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# POST /chess/{roomId}/ready
resource "aws_api_gateway_method" "post_chess_ready" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.chess_ready.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_chess_ready" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.chess_ready.id
  http_method             = aws_api_gateway_method.post_chess_ready.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.chess_service.invoke_arn
}

resource "aws_api_gateway_method" "options_chess_ready" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.chess_ready.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_chess_ready" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_ready.id
  http_method = aws_api_gateway_method.options_chess_ready.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_chess_ready" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_ready.id
  http_method = aws_api_gateway_method.options_chess_ready.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_chess_ready" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_ready.id
  http_method = aws_api_gateway_method.options_chess_ready.http_method
  status_code = aws_api_gateway_method_response.options_chess_ready.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# POST /chess/{roomId}/move
resource "aws_api_gateway_method" "post_chess_move" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.chess_move.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_chess_move" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.chess_move.id
  http_method             = aws_api_gateway_method.post_chess_move.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.chess_service.invoke_arn
}

resource "aws_api_gateway_method" "options_chess_move" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.chess_move.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_chess_move" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_move.id
  http_method = aws_api_gateway_method.options_chess_move.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_chess_move" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_move.id
  http_method = aws_api_gateway_method.options_chess_move.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_chess_move" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_move.id
  http_method = aws_api_gateway_method.options_chess_move.http_method
  status_code = aws_api_gateway_method_response.options_chess_move.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# POST /chess/{roomId}/draw
resource "aws_api_gateway_method" "post_chess_draw" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.chess_draw.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_chess_draw" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.chess_draw.id
  http_method             = aws_api_gateway_method.post_chess_draw.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.chess_service.invoke_arn
}

resource "aws_api_gateway_method" "options_chess_draw" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.chess_draw.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_chess_draw" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_draw.id
  http_method = aws_api_gateway_method.options_chess_draw.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_chess_draw" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_draw.id
  http_method = aws_api_gateway_method.options_chess_draw.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_chess_draw" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_draw.id
  http_method = aws_api_gateway_method.options_chess_draw.http_method
  status_code = aws_api_gateway_method_response.options_chess_draw.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# POST /chess/{roomId}/resign
resource "aws_api_gateway_method" "post_chess_resign" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.chess_resign.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_chess_resign" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.chess_resign.id
  http_method             = aws_api_gateway_method.post_chess_resign.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.chess_service.invoke_arn
}

resource "aws_api_gateway_method" "options_chess_resign" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.chess_resign.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_chess_resign" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_resign.id
  http_method = aws_api_gateway_method.options_chess_resign.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_chess_resign" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_resign.id
  http_method = aws_api_gateway_method.options_chess_resign.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_chess_resign" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_resign.id
  http_method = aws_api_gateway_method.options_chess_resign.http_method
  status_code = aws_api_gateway_method_response.options_chess_resign.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# POST /chess/{roomId}/forfeit
resource "aws_api_gateway_method" "post_chess_forfeit" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.chess_forfeit.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_chess_forfeit" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.chess_forfeit.id
  http_method             = aws_api_gateway_method.post_chess_forfeit.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.chess_service.invoke_arn
}

resource "aws_api_gateway_method" "options_chess_forfeit" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.chess_forfeit.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_chess_forfeit" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_forfeit.id
  http_method = aws_api_gateway_method.options_chess_forfeit.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_chess_forfeit" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_forfeit.id
  http_method = aws_api_gateway_method.options_chess_forfeit.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_chess_forfeit" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.chess_forfeit.id
  http_method = aws_api_gateway_method.options_chess_forfeit.http_method
  status_code = aws_api_gateway_method_response.options_chess_forfeit.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# ── Gomoku resources ──────────────────────────────────────────────────────────

resource "aws_api_gateway_resource" "gomoku" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_rest_api.rest.root_resource_id
  path_part   = "gomoku"
}

resource "aws_api_gateway_resource" "gomoku_room_id" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.gomoku.id
  path_part   = "{roomId}"
}

resource "aws_api_gateway_resource" "gomoku_ready" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.gomoku_room_id.id
  path_part   = "ready"
}

resource "aws_api_gateway_resource" "gomoku_place" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.gomoku_room_id.id
  path_part   = "place"
}

resource "aws_api_gateway_resource" "gomoku_forfeit" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.gomoku_room_id.id
  path_part   = "forfeit"
}

# GET /gomoku/{roomId}
resource "aws_api_gateway_method" "get_gomoku_state" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.gomoku_room_id.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_gomoku_state" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.gomoku_room_id.id
  http_method             = aws_api_gateway_method.get_gomoku_state.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.gomoku_service.invoke_arn
}

resource "aws_api_gateway_method" "options_gomoku_room" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.gomoku_room_id.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_gomoku_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.gomoku_room_id.id
  http_method = aws_api_gateway_method.options_gomoku_room.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_gomoku_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.gomoku_room_id.id
  http_method = aws_api_gateway_method.options_gomoku_room.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_gomoku_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.gomoku_room_id.id
  http_method = aws_api_gateway_method.options_gomoku_room.http_method
  status_code = aws_api_gateway_method_response.options_gomoku_room.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,GET'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# POST /gomoku/{roomId}/ready
resource "aws_api_gateway_method" "post_gomoku_ready" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.gomoku_ready.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_gomoku_ready" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.gomoku_ready.id
  http_method             = aws_api_gateway_method.post_gomoku_ready.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.gomoku_service.invoke_arn
}

resource "aws_api_gateway_method" "options_gomoku_ready" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.gomoku_ready.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_gomoku_ready" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.gomoku_ready.id
  http_method = aws_api_gateway_method.options_gomoku_ready.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_gomoku_ready" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.gomoku_ready.id
  http_method = aws_api_gateway_method.options_gomoku_ready.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_gomoku_ready" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.gomoku_ready.id
  http_method = aws_api_gateway_method.options_gomoku_ready.http_method
  status_code = aws_api_gateway_method_response.options_gomoku_ready.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# POST /gomoku/{roomId}/place
resource "aws_api_gateway_method" "post_gomoku_place" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.gomoku_place.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_gomoku_place" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.gomoku_place.id
  http_method             = aws_api_gateway_method.post_gomoku_place.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.gomoku_service.invoke_arn
}

resource "aws_api_gateway_method" "options_gomoku_place" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.gomoku_place.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_gomoku_place" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.gomoku_place.id
  http_method = aws_api_gateway_method.options_gomoku_place.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_gomoku_place" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.gomoku_place.id
  http_method = aws_api_gateway_method.options_gomoku_place.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_gomoku_place" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.gomoku_place.id
  http_method = aws_api_gateway_method.options_gomoku_place.http_method
  status_code = aws_api_gateway_method_response.options_gomoku_place.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# POST /gomoku/{roomId}/forfeit
resource "aws_api_gateway_method" "post_gomoku_forfeit" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.gomoku_forfeit.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_gomoku_forfeit" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.gomoku_forfeit.id
  http_method             = aws_api_gateway_method.post_gomoku_forfeit.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.gomoku_service.invoke_arn
}

resource "aws_api_gateway_method" "options_gomoku_forfeit" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.gomoku_forfeit.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_gomoku_forfeit" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.gomoku_forfeit.id
  http_method = aws_api_gateway_method.options_gomoku_forfeit.http_method
  type        = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_gomoku_forfeit" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.gomoku_forfeit.id
  http_method = aws_api_gateway_method.options_gomoku_forfeit.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_gomoku_forfeit" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.gomoku_forfeit.id
  http_method = aws_api_gateway_method.options_gomoku_forfeit.http_method
  status_code = aws_api_gateway_method_response.options_gomoku_forfeit.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# Lambda permissions for REST API
resource "aws_lambda_permission" "rest_room_service" {
  statement_id  = "AllowRestAPIInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.room_service.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.rest.execution_arn}/*/*"
}

resource "aws_lambda_permission" "rest_battleship_service" {
  statement_id  = "AllowRestBattleshipAPIInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.battleship_service.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.rest.execution_arn}/*/*"
}

resource "aws_lambda_permission" "rest_chess_service" {
  statement_id  = "AllowRestChessAPIInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.chess_service.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.rest.execution_arn}/*/*"
}

resource "aws_lambda_permission" "rest_gomoku_service" {
  statement_id  = "AllowRestGomokuAPIInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.gomoku_service.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.rest.execution_arn}/*/*"
}

# Deployment
resource "aws_api_gateway_deployment" "rest" {
  rest_api_id = aws_api_gateway_rest_api.rest.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_integration.post_rooms.id,
      aws_api_gateway_integration.get_room.id,
      aws_api_gateway_integration.join_room.id,
      aws_api_gateway_integration.leave_room.id,
      aws_api_gateway_integration.start_room.id,
      aws_api_gateway_integration.get_battleship_state.id,
      aws_api_gateway_integration.post_battleship_setup.id,
      aws_api_gateway_integration.post_battleship_fire.id,
      aws_api_gateway_integration.post_battleship_forfeit.id,
      aws_api_gateway_integration_response.options_rooms.id,
      aws_api_gateway_integration_response.options_room.id,
      aws_api_gateway_integration_response.options_join_room.id,
      aws_api_gateway_integration_response.options_leave_room.id,
      aws_api_gateway_integration_response.options_start_room.id,
      aws_api_gateway_integration_response.options_battleship_room.id,
      aws_api_gateway_integration_response.options_battleship_setup.id,
      aws_api_gateway_integration_response.options_battleship_fire.id,
      aws_api_gateway_integration_response.options_battleship_forfeit.id,
      aws_api_gateway_integration.get_chess_state.id,
      aws_api_gateway_integration.post_chess_ready.id,
      aws_api_gateway_integration.post_chess_move.id,
      aws_api_gateway_integration.post_chess_draw.id,
      aws_api_gateway_integration.post_chess_resign.id,
      aws_api_gateway_integration.post_chess_forfeit.id,
      aws_api_gateway_integration_response.options_chess_room.id,
      aws_api_gateway_integration_response.options_chess_ready.id,
      aws_api_gateway_integration_response.options_chess_move.id,
      aws_api_gateway_integration_response.options_chess_draw.id,
      aws_api_gateway_integration_response.options_chess_resign.id,
      aws_api_gateway_integration_response.options_chess_forfeit.id,
      aws_api_gateway_integration.get_gomoku_state.id,
      aws_api_gateway_integration.post_gomoku_ready.id,
      aws_api_gateway_integration.post_gomoku_place.id,
      aws_api_gateway_integration.post_gomoku_forfeit.id,
      aws_api_gateway_integration_response.options_gomoku_room.id,
      aws_api_gateway_integration_response.options_gomoku_ready.id,
      aws_api_gateway_integration_response.options_gomoku_place.id,
      aws_api_gateway_integration_response.options_gomoku_forfeit.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.post_rooms,
    aws_api_gateway_integration.get_room,
    aws_api_gateway_integration.join_room,
    aws_api_gateway_integration.leave_room,
    aws_api_gateway_integration.start_room,
    aws_api_gateway_integration.get_battleship_state,
    aws_api_gateway_integration.post_battleship_setup,
    aws_api_gateway_integration.post_battleship_fire,
    aws_api_gateway_integration.post_battleship_forfeit,
    aws_api_gateway_integration_response.options_rooms,
    aws_api_gateway_integration_response.options_room,
    aws_api_gateway_integration_response.options_join_room,
    aws_api_gateway_integration_response.options_leave_room,
    aws_api_gateway_integration_response.options_start_room,
    aws_api_gateway_integration_response.options_battleship_room,
    aws_api_gateway_integration_response.options_battleship_setup,
    aws_api_gateway_integration_response.options_battleship_fire,
    aws_api_gateway_integration_response.options_battleship_forfeit,
    aws_api_gateway_integration.get_chess_state,
    aws_api_gateway_integration.post_chess_ready,
    aws_api_gateway_integration.post_chess_move,
    aws_api_gateway_integration.post_chess_draw,
    aws_api_gateway_integration.post_chess_resign,
    aws_api_gateway_integration.post_chess_forfeit,
    aws_api_gateway_integration_response.options_chess_room,
    aws_api_gateway_integration_response.options_chess_ready,
    aws_api_gateway_integration_response.options_chess_move,
    aws_api_gateway_integration_response.options_chess_draw,
    aws_api_gateway_integration_response.options_chess_resign,
    aws_api_gateway_integration_response.options_chess_forfeit,
    aws_api_gateway_integration.get_gomoku_state,
    aws_api_gateway_integration.post_gomoku_ready,
    aws_api_gateway_integration.post_gomoku_place,
    aws_api_gateway_integration.post_gomoku_forfeit,
    aws_api_gateway_integration_response.options_gomoku_room,
    aws_api_gateway_integration_response.options_gomoku_ready,
    aws_api_gateway_integration_response.options_gomoku_place,
    aws_api_gateway_integration_response.options_gomoku_forfeit,
  ]
}

resource "aws_api_gateway_stage" "rest" {
  deployment_id = aws_api_gateway_deployment.rest.id
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  stage_name    = "prod"
}
