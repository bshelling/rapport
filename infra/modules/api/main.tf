# FastAPI on Lambda behind an API Gateway HTTP API.
# CloudFront forwards /api/* here, so browsers never call this endpoint directly.

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

variable "env" {
  type = string
}

variable "zip_path" {
  description = "Path to the Lambda deployment package built by scripts/build-api-zip.sh."
  type        = string
}

variable "app_version" {
  type = string
}

variable "table_name" {
  type = string
}

variable "table_arn" {
  type = string
}

variable "photo_bucket_name" {
  type = string
}

variable "photo_bucket_arn" {
  type = string
}

variable "jwt_issuer" {
  description = "Cognito user pool issuer URL."
  type        = string
}

variable "jwt_audience" {
  description = "Cognito app client IDs whose ID tokens are accepted."
  type        = list(string)
}

variable "claude_model" {
  description = "Bedrock model ID used for photo triage."
  type        = string
  default     = "anthropic.claude-opus-5"
}

variable "typesafe_key_param" {
  description = "SSM SecureString holding the TypeSafe (Jev) API key (created out of band)."
  type        = string
}

variable "ai_mode" {
  description = "live = Bedrock + TypeSafe; fake = deterministic stand-ins."
  type        = string
  default     = "live"
}

variable "public_routes" {
  description = "Routes served without sign-in. Everything else under /api requires a valid token."
  type        = list(string)
  default = [
    "GET /api/health",
    "GET /api/neighborhoods",
    "GET /api/service-catalog",
    "GET /api/map/reports",
    "GET /api/stats",
    "GET /api/docs",
    "GET /api/openapi.json",
  ]
}

locals {
  name        = "rapport-api-${var.env}"
  worker_name = "rapport-worker-${var.env}"
  ingest_name = "rapport-ingest-${var.env}"
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = local.name
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy_attachment" "logs" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "api" {
  statement {
    sid = "Table"
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
      "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem", "dynamodb:TransactWriteItems",
      "dynamodb:ConditionCheckItem",
    ]
    resources = [var.table_arn, "${var.table_arn}/index/*"]
  }
  statement {
    sid       = "Photos"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${var.photo_bucket_arn}/*"]
  }
  statement {
    sid       = "StartWorker"
    actions   = ["lambda:InvokeFunction"]
    resources = ["arn:aws:lambda:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:function:${local.worker_name}"]
  }
  statement {
    sid = "PlaceSearch"
    actions = [
      "geo-places:Autocomplete",
      "geo-places:GetPlace",
      "geo-places:ReverseGeocode",
    ]
    resources = ["arn:aws:geo-places:${data.aws_region.current.region}::provider/default"]
  }
  # Lets HeadObject report 404 (not 403) for photos that were never uploaded.
  statement {
    sid       = "PhotosList"
    actions   = ["s3:ListBucket"]
    resources = [var.photo_bucket_arn]
  }
}

resource "aws_iam_role_policy" "api" {
  name   = local.name
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.name}"
  retention_in_days = 14
}

resource "aws_lambda_function" "api" {
  function_name    = local.name
  role             = aws_iam_role.api.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "app.main.handler"
  filename         = var.zip_path
  source_code_hash = filebase64sha256(var.zip_path)
  memory_size      = 512
  timeout          = 29

  environment {
    variables = {
      RAPPORT_ENVIRONMENT     = var.env
      RAPPORT_VERSION         = var.app_version
      RAPPORT_CORS_ORIGINS    = "[]"
      RAPPORT_TABLE_NAME      = var.table_name
      RAPPORT_PHOTO_BUCKET    = var.photo_bucket_name
      RAPPORT_AUTH_MODE       = "apigw"
      RAPPORT_WORKER_MODE     = "lambda"
      RAPPORT_WORKER_FUNCTION = local.worker_name
      RAPPORT_AI_MODE         = var.ai_mode
      RAPPORT_GEO_MODE        = "live"
      RAPPORT_NOLA311_MODE    = "live"
    }
  }

  depends_on = [aws_cloudwatch_log_group.api, aws_iam_role_policy_attachment.logs]
}

# --- Worker: AI processing, invoked asynchronously by the API --------------------

resource "aws_iam_role" "worker" {
  name               = local.worker_name
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy_attachment" "worker_logs" {
  role       = aws_iam_role.worker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "worker" {
  statement {
    sid       = "Drafts"
    actions   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
    resources = [var.table_arn]
  }
  # Duplicate detection looks up nearby reports by geohash cell (GSI2).
  statement {
    sid       = "NearbyReports"
    actions   = ["dynamodb:Query"]
    resources = ["${var.table_arn}/index/GSI2"]
  }
  statement {
    sid       = "ReadPhotos"
    actions   = ["s3:GetObject"]
    resources = ["${var.photo_bucket_arn}/drafts/*"]
  }
  statement {
    sid = "Claude"
    actions = [
      "bedrock-mantle:CreateInference",
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = ["*"]
  }
  statement {
    sid       = "TypeSafeKey"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${var.typesafe_key_param}"]
  }
  statement {
    sid       = "DecryptViaSsm"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${data.aws_region.current.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "worker" {
  name   = local.worker_name
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker.json
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/lambda/${local.worker_name}"
  retention_in_days = 14
}

resource "aws_lambda_function" "worker" {
  function_name    = local.worker_name
  role             = aws_iam_role.worker.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "app.worker.handler"
  filename         = var.zip_path
  source_code_hash = filebase64sha256(var.zip_path)
  memory_size      = 1024
  timeout          = 90
  # Caps concurrent AI calls (and spend).
  reserved_concurrent_executions = 5

  environment {
    variables = {
      RAPPORT_ENVIRONMENT        = var.env
      RAPPORT_VERSION            = var.app_version
      RAPPORT_TABLE_NAME         = var.table_name
      RAPPORT_PHOTO_BUCKET       = var.photo_bucket_name
      RAPPORT_AI_MODE            = var.ai_mode
      RAPPORT_CLAUDE_MODEL       = var.claude_model
      RAPPORT_TYPESAFE_KEY_PARAM = var.typesafe_key_param
    }
  }

  depends_on = [aws_cloudwatch_log_group.worker, aws_iam_role_policy_attachment.worker_logs]
}

# No automatic retries: a failed triage is recorded on the draft instead of re-billed.
resource "aws_lambda_function_event_invoke_config" "worker" {
  function_name                = aws_lambda_function.worker.function_name
  maximum_retry_attempts       = 0
  maximum_event_age_in_seconds = 300
}

# --- Ingest: nightly NOLA 311 import -------------------------------------------------

resource "aws_iam_role" "ingest" {
  name               = local.ingest_name
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy_attachment" "ingest_logs" {
  role       = aws_iam_role.ingest.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "ingest" {
  statement {
    sid = "Table"
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
      "dynamodb:BatchWriteItem", "dynamodb:TransactWriteItems", "dynamodb:Query",
    ]
    resources = [var.table_arn, "${var.table_arn}/index/*"]
  }
  statement {
    sid       = "TypeSafeKey"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${var.typesafe_key_param}"]
  }
  statement {
    sid       = "DecryptViaSsm"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${data.aws_region.current.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ingest" {
  name   = local.ingest_name
  role   = aws_iam_role.ingest.id
  policy = data.aws_iam_policy_document.ingest.json
}

resource "aws_cloudwatch_log_group" "ingest" {
  name              = "/aws/lambda/${local.ingest_name}"
  retention_in_days = 30
}

resource "aws_lambda_function" "ingest" {
  function_name    = local.ingest_name
  role             = aws_iam_role.ingest.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "app.ingest.handler"
  filename         = var.zip_path
  source_code_hash = filebase64sha256(var.zip_path)
  memory_size      = 1024
  timeout          = 900

  environment {
    variables = {
      RAPPORT_ENVIRONMENT        = var.env
      RAPPORT_VERSION            = var.app_version
      RAPPORT_TABLE_NAME         = var.table_name
      RAPPORT_AI_MODE            = var.ai_mode
      RAPPORT_TYPESAFE_KEY_PARAM = var.typesafe_key_param
      RAPPORT_NOLA311_MODE       = "live"
    }
  }

  depends_on = [aws_cloudwatch_log_group.ingest, aws_iam_role_policy_attachment.ingest_logs]
}

resource "aws_lambda_function_event_invoke_config" "ingest" {
  function_name          = aws_lambda_function.ingest.function_name
  maximum_retry_attempts = 0
}

# 08:00 UTC = 3 am in New Orleans in summer (2 am in winter); data.nola.gov refreshes overnight.
resource "aws_cloudwatch_event_rule" "ingest_nightly" {
  name                = "${local.ingest_name}-nightly"
  schedule_expression = "cron(0 8 * * ? *)"
}

resource "aws_cloudwatch_event_target" "ingest_nightly" {
  rule = aws_cloudwatch_event_rule.ingest_nightly.name
  arn  = aws_lambda_function.ingest.arn
}

resource "aws_lambda_permission" "ingest_schedule" {
  statement_id  = "AllowNightlySchedule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingest.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.ingest_nightly.arn
}

resource "aws_apigatewayv2_api" "api" {
  name          = local.name
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.api.id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = var.jwt_issuer
    audience = var.jwt_audience
  }
}

# Secure by default: the catch-all route requires a Cognito ID token.
resource "aws_apigatewayv2_route" "api" {
  api_id             = aws_apigatewayv2_api.api.id
  route_key          = "ANY /api/{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# More specific routes win over the greedy one, so these stay public.
resource "aws_apigatewayv2_route" "public" {
  for_each  = toset(var.public_routes)
  api_id    = aws_apigatewayv2_api.api.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowHttpApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.api.api_endpoint
}

output "function_name" {
  value = aws_lambda_function.api.function_name
}

output "ingest_function_name" {
  value = aws_lambda_function.ingest.function_name
}

output "worker_function_name" {
  value = aws_lambda_function.worker.function_name
}
