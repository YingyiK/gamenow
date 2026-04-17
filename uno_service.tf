# ---------------------------------------------------------------------------
# DynamoDB — UNO game state
# ---------------------------------------------------------------------------

resource "aws_dynamodb_table" "uno_games" {
  name         = "${var.project}-uno-games"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "roomId"

  attribute {
    name = "roomId"
    type = "S"
  }

  tags = { Project = var.project }
}

# ---------------------------------------------------------------------------
# Lambda — package and function
# ---------------------------------------------------------------------------

data "archive_file" "uno_service" {
  type        = "zip"
  source_file = "${path.module}/lambdas/uno_service/handler.py"
  output_path = "${path.module}/zips/uno_service.zip"
}

resource "aws_lambda_function" "uno_service" {
  function_name    = "${var.project}-uno-service"
  filename         = data.archive_file.uno_service.output_path
  source_code_hash = data.archive_file.uno_service.output_base64sha256
  handler          = "handler.lambda_handler"
  runtime          = "python3.12"
  role             = aws_iam_role.lambda_exec.arn
  timeout          = 30

  environment {
    variables = {
      ROOMS_TABLE       = aws_dynamodb_table.rooms.name
      CONNECTIONS_TABLE = aws_dynamodb_table.connections.name
      UNO_TABLE         = aws_dynamodb_table.uno_games.name
      WS_ENDPOINT       = "https://${aws_apigatewayv2_api.websocket.id}.execute-api.${var.aws_region}.amazonaws.com/${aws_apigatewayv2_stage.websocket.name}"
    }
  }

  tags = { Project = var.project }
}

resource "aws_lambda_permission" "rest_uno_service" {
  statement_id  = "AllowRestUnoAPIInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.uno_service.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.rest.execution_arn}/*/*"
}

resource "aws_iam_role_policy" "uno_dynamodb" {
  name = "${var.project}-uno-dynamodb"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
        "dynamodb:DeleteItem", "dynamodb:Query",
      ]
      Resource = [aws_dynamodb_table.uno_games.arn]
    }]
  })
}

# ---------------------------------------------------------------------------
# API Gateway resources
# ---------------------------------------------------------------------------

resource "aws_api_gateway_resource" "uno" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_rest_api.rest.root_resource_id
  path_part   = "uno"
}

resource "aws_api_gateway_resource" "uno_room_id" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.uno.id
  path_part   = "{roomId}"
}

resource "aws_api_gateway_resource" "uno_start" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.uno_room_id.id
  path_part   = "start"
}

resource "aws_api_gateway_resource" "uno_play" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.uno_room_id.id
  path_part   = "play"
}

resource "aws_api_gateway_resource" "uno_draw" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.uno_room_id.id
  path_part   = "draw"
}

resource "aws_api_gateway_resource" "uno_say_uno" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.uno_room_id.id
  path_part   = "uno"
}

resource "aws_api_gateway_resource" "uno_forfeit" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  parent_id   = aws_api_gateway_resource.uno_room_id.id
  path_part   = "forfeit"
}

# ---------------------------------------------------------------------------
# GET /uno/{roomId}
# ---------------------------------------------------------------------------

resource "aws_api_gateway_method" "get_uno_state" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.uno_room_id.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_uno_state" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.uno_room_id.id
  http_method             = aws_api_gateway_method.get_uno_state.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.uno_service.invoke_arn
}

resource "aws_api_gateway_method" "options_uno_room" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.uno_room_id.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_uno_room" {
  rest_api_id       = aws_api_gateway_rest_api.rest.id
  resource_id       = aws_api_gateway_resource.uno_room_id.id
  http_method       = aws_api_gateway_method.options_uno_room.http_method
  type              = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_uno_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.uno_room_id.id
  http_method = aws_api_gateway_method.options_uno_room.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_uno_room" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.uno_room_id.id
  http_method = aws_api_gateway_method.options_uno_room.http_method
  status_code = aws_api_gateway_method_response.options_uno_room.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,GET'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# ---------------------------------------------------------------------------
# POST /uno/{roomId}/start
# ---------------------------------------------------------------------------

resource "aws_api_gateway_method" "post_uno_start" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.uno_start.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_uno_start" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.uno_start.id
  http_method             = aws_api_gateway_method.post_uno_start.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.uno_service.invoke_arn
}

resource "aws_api_gateway_method" "options_uno_start" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.uno_start.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_uno_start" {
  rest_api_id       = aws_api_gateway_rest_api.rest.id
  resource_id       = aws_api_gateway_resource.uno_start.id
  http_method       = aws_api_gateway_method.options_uno_start.http_method
  type              = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_uno_start" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.uno_start.id
  http_method = aws_api_gateway_method.options_uno_start.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_uno_start" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.uno_start.id
  http_method = aws_api_gateway_method.options_uno_start.http_method
  status_code = aws_api_gateway_method_response.options_uno_start.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# ---------------------------------------------------------------------------
# POST /uno/{roomId}/play
# ---------------------------------------------------------------------------

resource "aws_api_gateway_method" "post_uno_play" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.uno_play.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_uno_play" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.uno_play.id
  http_method             = aws_api_gateway_method.post_uno_play.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.uno_service.invoke_arn
}

resource "aws_api_gateway_method" "options_uno_play" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.uno_play.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_uno_play" {
  rest_api_id       = aws_api_gateway_rest_api.rest.id
  resource_id       = aws_api_gateway_resource.uno_play.id
  http_method       = aws_api_gateway_method.options_uno_play.http_method
  type              = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_uno_play" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.uno_play.id
  http_method = aws_api_gateway_method.options_uno_play.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_uno_play" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.uno_play.id
  http_method = aws_api_gateway_method.options_uno_play.http_method
  status_code = aws_api_gateway_method_response.options_uno_play.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# ---------------------------------------------------------------------------
# POST /uno/{roomId}/draw
# ---------------------------------------------------------------------------

resource "aws_api_gateway_method" "post_uno_draw" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.uno_draw.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_uno_draw" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.uno_draw.id
  http_method             = aws_api_gateway_method.post_uno_draw.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.uno_service.invoke_arn
}

resource "aws_api_gateway_method" "options_uno_draw" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.uno_draw.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_uno_draw" {
  rest_api_id       = aws_api_gateway_rest_api.rest.id
  resource_id       = aws_api_gateway_resource.uno_draw.id
  http_method       = aws_api_gateway_method.options_uno_draw.http_method
  type              = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_uno_draw" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.uno_draw.id
  http_method = aws_api_gateway_method.options_uno_draw.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_uno_draw" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.uno_draw.id
  http_method = aws_api_gateway_method.options_uno_draw.http_method
  status_code = aws_api_gateway_method_response.options_uno_draw.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# ---------------------------------------------------------------------------
# POST /uno/{roomId}/uno
# ---------------------------------------------------------------------------

resource "aws_api_gateway_method" "post_uno_say_uno" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.uno_say_uno.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_uno_say_uno" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.uno_say_uno.id
  http_method             = aws_api_gateway_method.post_uno_say_uno.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.uno_service.invoke_arn
}

resource "aws_api_gateway_method" "options_uno_say_uno" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.uno_say_uno.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_uno_say_uno" {
  rest_api_id       = aws_api_gateway_rest_api.rest.id
  resource_id       = aws_api_gateway_resource.uno_say_uno.id
  http_method       = aws_api_gateway_method.options_uno_say_uno.http_method
  type              = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_uno_say_uno" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.uno_say_uno.id
  http_method = aws_api_gateway_method.options_uno_say_uno.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_uno_say_uno" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.uno_say_uno.id
  http_method = aws_api_gateway_method.options_uno_say_uno.http_method
  status_code = aws_api_gateway_method_response.options_uno_say_uno.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# ---------------------------------------------------------------------------
# POST /uno/{roomId}/forfeit
# ---------------------------------------------------------------------------

resource "aws_api_gateway_method" "post_uno_forfeit" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.uno_forfeit.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "post_uno_forfeit" {
  rest_api_id             = aws_api_gateway_rest_api.rest.id
  resource_id             = aws_api_gateway_resource.uno_forfeit.id
  http_method             = aws_api_gateway_method.post_uno_forfeit.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.uno_service.invoke_arn
}

resource "aws_api_gateway_method" "options_uno_forfeit" {
  rest_api_id   = aws_api_gateway_rest_api.rest.id
  resource_id   = aws_api_gateway_resource.uno_forfeit.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options_uno_forfeit" {
  rest_api_id       = aws_api_gateway_rest_api.rest.id
  resource_id       = aws_api_gateway_resource.uno_forfeit.id
  http_method       = aws_api_gateway_method.options_uno_forfeit.http_method
  type              = "MOCK"
  request_templates = { "application/json" = "{\"statusCode\": 200}" }
}

resource "aws_api_gateway_method_response" "options_uno_forfeit" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.uno_forfeit.id
  http_method = aws_api_gateway_method.options_uno_forfeit.http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options_uno_forfeit" {
  rest_api_id = aws_api_gateway_rest_api.rest.id
  resource_id = aws_api_gateway_resource.uno_forfeit.id
  http_method = aws_api_gateway_method.options_uno_forfeit.http_method
  status_code = aws_api_gateway_method_response.options_uno_forfeit.status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type'"
    "method.response.header.Access-Control-Allow-Methods" = "'OPTIONS,POST'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# ---------------------------------------------------------------------------
# Redeploy REST API to activate UNO routes
# Note: add these integration IDs to the existing deployment triggers in
# api_gateway_rest.tf, or use this separate deployment resource.
# ---------------------------------------------------------------------------

resource "aws_api_gateway_deployment" "uno" {
  rest_api_id = aws_api_gateway_rest_api.rest.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_integration.get_uno_state.id,
      aws_api_gateway_integration.post_uno_start.id,
      aws_api_gateway_integration.post_uno_play.id,
      aws_api_gateway_integration.post_uno_draw.id,
      aws_api_gateway_integration.post_uno_say_uno.id,
      aws_api_gateway_integration.post_uno_forfeit.id,
      aws_api_gateway_integration_response.options_uno_room.id,
      aws_api_gateway_integration_response.options_uno_start.id,
      aws_api_gateway_integration_response.options_uno_play.id,
      aws_api_gateway_integration_response.options_uno_draw.id,
      aws_api_gateway_integration_response.options_uno_say_uno.id,
      aws_api_gateway_integration_response.options_uno_forfeit.id,
    ]))
  }

  depends_on = [
    aws_api_gateway_integration.get_uno_state,
    aws_api_gateway_integration.post_uno_start,
    aws_api_gateway_integration.post_uno_play,
    aws_api_gateway_integration.post_uno_draw,
    aws_api_gateway_integration.post_uno_say_uno,
    aws_api_gateway_integration.post_uno_forfeit,
  ]

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# 自动把最新 deployment 关联到 prod stage
# ---------------------------------------------------------------------------

resource "null_resource" "update_stage" {
  triggers = {
    deployment_id = aws_api_gateway_deployment.uno.id
  }

  provisioner "local-exec" {
    command = "aws apigateway update-stage --rest-api-id ${aws_api_gateway_rest_api.rest.id} --stage-name prod --patch-operations op=replace,path=/deploymentId,value=${aws_api_gateway_deployment.uno.id} --region us-west-2"
  }

  depends_on = [aws_api_gateway_deployment.uno]
}

