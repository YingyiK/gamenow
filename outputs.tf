output "rest_api_url" {
  description = "Base URL for the REST API — share with teammates"
  value       = "${aws_api_gateway_stage.rest.invoke_url}"
}

output "rest_api_id" {
  description = "REST API Gateway id (for scripts/cleanup_legacy_room_ids.py apigw)"
  value       = aws_api_gateway_rest_api.rest.id
}

output "websocket_url" {
  description = "WebSocket URL — share with teammates and frontend"
  value       = "${aws_apigatewayv2_stage.websocket.invoke_url}"
}

output "frontend_url" {
  description = "CloudFront URL for the hosted frontend"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "frontend_bucket_name" {
  description = "S3 bucket storing the frontend assets"
  value       = aws_s3_bucket.frontend.bucket
}

output "rooms_table_name" {
  value = aws_dynamodb_table.rooms.name
}

output "connections_table_name" {
  value = aws_dynamodb_table.connections.name
}

output "battleship_table_name" {
  value = aws_dynamodb_table.battleship_games.name
}

output "terraform_state_bucket" {
  description = "S3 bucket holding Terraform remote state (configure backend in main.tf)"
  value       = aws_s3_bucket.terraform_state.bucket
}

output "terraform_lock_table" {
  description = "DynamoDB table used for Terraform state locking"
  value       = aws_dynamodb_table.terraform_lock.name
}
