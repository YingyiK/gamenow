terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state: created by aws_s3_bucket.terraform_state in backend_state.tf
  backend "s3" {
    bucket         = "game-platform-terraform-state-812835203753"
    key            = "gamenow/terraform.tfstate"
    region         = "us-west-2"
    dynamodb_table = "game-platform-terraform-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

# ── Variables ───────────────────────────────────────────────────────────────

variable "aws_region" {
  default = "us-west-2"
}

variable "project" {
  default = "game-platform"
}

# ── Frontend static hosting ───────────────────────────────────────────────────

resource "aws_s3_bucket" "frontend" {
  bucket_prefix = "${var.project}-frontend-"

  tags = { Project = var.project }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_object" "frontend_index" {
  bucket       = aws_s3_bucket.frontend.id
  key          = "index.html"
  source       = "${path.module}/frontend/index.html"
  etag         = filemd5("${path.module}/frontend/index.html")
  content_type = "text/html; charset=utf-8"
}

resource "aws_s3_object" "frontend_app" {
  bucket       = aws_s3_bucket.frontend.id
  key          = "app.js"
  source       = "${path.module}/frontend/app.js"
  etag         = filemd5("${path.module}/frontend/app.js")
  content_type = "application/javascript"
}

resource "aws_s3_object" "frontend_styles" {
  bucket       = aws_s3_bucket.frontend.id
  key          = "styles.css"
  source       = "${path.module}/frontend/styles.css"
  etag         = filemd5("${path.module}/frontend/styles.css")
  content_type = "text/css; charset=utf-8"
}

resource "aws_s3_object" "frontend_logo" {
  bucket       = aws_s3_bucket.frontend.id
  key          = "gamenow-logo.png"
  source       = "${path.module}/frontend/gamenow-logo.png"
  etag         = filemd5("${path.module}/frontend/gamenow-logo.png")
  content_type = "image/png"
}

resource "aws_s3_object" "frontend_uno_html" {
  bucket       = aws_s3_bucket.frontend.id
  key          = "uno.html"
  source       = "${path.module}/frontend/uno.html"
  etag         = filemd5("${path.module}/frontend/uno.html")
  content_type = "text/html; charset=utf-8"
}

resource "aws_s3_object" "frontend_uno_js" {
  bucket       = aws_s3_bucket.frontend.id
  key          = "uno.js"
  source       = "${path.module}/frontend/uno.js"
  etag         = filemd5("${path.module}/frontend/uno.js")
  content_type = "application/javascript"
}

resource "aws_s3_object" "frontend_battleship_html" {
  bucket       = aws_s3_bucket.frontend.id
  key          = "battleship.html"
  source       = "${path.module}/frontend/battleship.html"
  etag         = filemd5("${path.module}/frontend/battleship.html")
  content_type = "text/html; charset=utf-8"
}

resource "aws_cloudfront_function" "uno_rewrite" {
  name    = "${var.project}-uno-rewrite"
  runtime = "cloudfront-js-1.0"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      if (!uri.match(/\.(js|css|png|ico|jpg|jpeg|gif|svg|woff|woff2)$/)) {
        request.uri = '/uno.html';
      }
      return request;
    }
  EOT
}

resource "aws_cloudfront_function" "battleship_rewrite" {
  name    = "${var.project}-battleship-rewrite"
  runtime = "cloudfront-js-1.0"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      if (!uri.match(/\.(js|css|png|ico|jpg|jpeg|gif|svg|woff|woff2)$/)) {
        request.uri = '/battleship.html';
      }
      return request;
    }
  EOT
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.project}-frontend-oac"
  description                       = "OAC for GameNow frontend bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "frontend-s3-origin"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "frontend-s3-origin"

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 300
    max_ttl                = 86400
    compress               = true
  }

  ordered_cache_behavior {
    path_pattern     = "/uno*"
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "frontend-s3-origin"

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 300
    max_ttl                = 86400
    compress               = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.uno_rewrite.arn
    }
  }

  ordered_cache_behavior {
    path_pattern     = "/battleship*"
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "frontend-s3-origin"

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 300
    max_ttl                = 86400
    compress               = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.battleship_rewrite.arn
    }
  }

  # SPA fallback so /battleship/1234 refreshes to index.html.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  depends_on = [
    aws_s3_object.frontend_index,
    aws_s3_object.frontend_app,
    aws_s3_object.frontend_styles,
  ]

  tags = { Project = var.project }
}

data "aws_iam_policy_document" "frontend_bucket_policy" {
  statement {
    sid = "AllowCloudFrontRead"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions = ["s3:GetObject"]
    resources = [
      "${aws_s3_bucket.frontend.arn}/*",
    ]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.frontend.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend_bucket_policy.json
}

# ── DynamoDB tables ─────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "rooms" {
  name         = "${var.project}-rooms"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "roomId"

  attribute {
    name = "roomId"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  tags = { Project = var.project }
}

resource "aws_dynamodb_table" "connections" {
  name         = "${var.project}-connections"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "connectionId"

  attribute {
    name = "connectionId"
    type = "S"
  }

  attribute {
    name = "roomId"
    type = "S"
  }

  global_secondary_index {
    name            = "roomId-index"
    hash_key        = "roomId"
    projection_type = "KEYS_ONLY"
  }

  tags = { Project = var.project }
}

resource "aws_dynamodb_table" "battleship_games" {
  name         = "${var.project}-battleship-games"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "roomId"

  attribute {
    name = "roomId"
    type = "S"
  }

  tags = { Project = var.project }
}

# ── IAM role shared by all Lambdas ──────────────────────────────────────────

resource "aws_iam_role" "lambda_exec" {
  name = "${var.project}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "lambda_policy" {
  name = "${var.project}-lambda-policy"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
          "dynamodb:DeleteItem", "dynamodb:Scan", "dynamodb:Query"
        ]
        Resource = [
          aws_dynamodb_table.rooms.arn,
          aws_dynamodb_table.connections.arn,
          "${aws_dynamodb_table.connections.arn}/index/roomId-index",
          aws_dynamodb_table.battleship_games.arn,
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["execute-api:ManageConnections"]
        Resource = "${aws_apigatewayv2_api.websocket.execution_arn}/*/*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# ── Lambda: room_service ─────────────────────────────────────────────────────

data "archive_file" "room_service" {
  type        = "zip"
  source_file = "${path.module}/lambdas/room_service/handler.py"
  output_path = "${path.module}/zips/room_service.zip"
}

resource "aws_lambda_function" "room_service" {
  function_name    = "${var.project}-room-service"
  filename         = data.archive_file.room_service.output_path
  source_code_hash = data.archive_file.room_service.output_base64sha256
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  role             = aws_iam_role.lambda_exec.arn
  timeout          = 10

  environment {
    variables = {
      ROOMS_TABLE       = aws_dynamodb_table.rooms.name
      CONNECTIONS_TABLE = aws_dynamodb_table.connections.name
      WS_ENDPOINT       = "https://${aws_apigatewayv2_api.websocket.id}.execute-api.${var.aws_region}.amazonaws.com/${aws_apigatewayv2_stage.websocket.name}"
    }
  }

  tags = { Project = var.project }
}

# ── Lambda: websocket_handler ────────────────────────────────────────────────

data "archive_file" "websocket_handler" {
  type        = "zip"
  source_file = "${path.module}/lambdas/websocket_handler/handler.py"
  output_path = "${path.module}/zips/websocket_handler.zip"
}

resource "aws_lambda_function" "websocket_handler" {
  function_name    = "${var.project}-websocket-handler"
  filename         = data.archive_file.websocket_handler.output_path
  source_code_hash = data.archive_file.websocket_handler.output_base64sha256
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  role             = aws_iam_role.lambda_exec.arn
  timeout          = 10

  environment {
    variables = {
      CONNECTIONS_TABLE = aws_dynamodb_table.connections.name
      ROOMS_TABLE       = aws_dynamodb_table.rooms.name
      WS_ENDPOINT       = "https://${aws_apigatewayv2_api.websocket.id}.execute-api.${var.aws_region}.amazonaws.com/${aws_apigatewayv2_stage.websocket.name}"
    }
  }

  tags = { Project = var.project }
}

# ── Lambda: chat_service ─────────────────────────────────────────────────────

data "archive_file" "chat_service" {
  type        = "zip"
  source_file = "${path.module}/lambdas/chat_service/handler.py"
  output_path = "${path.module}/zips/chat_service.zip"
}

resource "aws_lambda_function" "chat_service" {
  function_name    = "${var.project}-chat-service"
  filename         = data.archive_file.chat_service.output_path
  source_code_hash = data.archive_file.chat_service.output_base64sha256
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  role             = aws_iam_role.lambda_exec.arn
  timeout          = 10

  environment {
    variables = {
      CONNECTIONS_TABLE = aws_dynamodb_table.connections.name
      WS_ENDPOINT       = "https://${aws_apigatewayv2_api.websocket.id}.execute-api.${var.aws_region}.amazonaws.com/${aws_apigatewayv2_stage.websocket.name}"
    }
  }

  tags = { Project = var.project }
}

# ── Lambda: battleship_service ───────────────────────────────────────────────

data "archive_file" "battleship_service" {
  type        = "zip"
  source_file = "${path.module}/lambdas/battleship_service/handler.py"
  output_path = "${path.module}/zips/battleship_service.zip"
}

resource "aws_lambda_function" "battleship_service" {
  function_name    = "${var.project}-battleship-service"
  filename         = data.archive_file.battleship_service.output_path
  source_code_hash = data.archive_file.battleship_service.output_base64sha256
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  role             = aws_iam_role.lambda_exec.arn
  timeout          = 15

  environment {
    variables = {
      ROOMS_TABLE       = aws_dynamodb_table.rooms.name
      CONNECTIONS_TABLE = aws_dynamodb_table.connections.name
      BATTLESHIP_TABLE  = aws_dynamodb_table.battleship_games.name
      WS_ENDPOINT       = "https://${aws_apigatewayv2_api.websocket.id}.execute-api.${var.aws_region}.amazonaws.com/${aws_apigatewayv2_stage.websocket.name}"
    }
  }

  tags = { Project = var.project }
}
