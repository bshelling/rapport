# Chat agent: Strands on AgentCore Runtime (direct code deployment) + AgentCore Memory.
# Only the API Lambda invokes it, passing the verified user id.

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
  description = "Agent package from scripts/build-agent-zip.sh."
  type        = string
}

variable "code_bucket_name" {
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

variable "typesafe_key_param" {
  type = string
}

variable "model_id" {
  description = "Bedrock inference profile the agent reasons with (Converse API)."
  type        = string
  default     = "us.anthropic.claude-opus-4-6-v1"
}

locals {
  # Runtime and memory names allow letters, digits and underscores only.
  name = "rapport_agent_${var.env}"
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account = data.aws_caller_identity.current.account_id
  region  = data.aws_region.current.region
}

# --- Code artifact ---------------------------------------------------------------

resource "aws_s3_bucket" "code" {
  bucket = var.code_bucket_name
}

resource "aws_s3_bucket_public_access_block" "code" {
  bucket                  = aws_s3_bucket.code.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "code" {
  bucket = aws_s3_bucket.code.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "code" {
  bucket = aws_s3_bucket.code.id
  rule {
    id     = "old-builds"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 14
    }
  }
  depends_on = [aws_s3_bucket_versioning.code]
}

resource "aws_s3_object" "code" {
  bucket = aws_s3_bucket.code.id
  key    = "agent/agent.zip"
  source = var.zip_path
  etag   = filemd5(var.zip_path)
}

# --- Memory: short-term conversation history per chat session ----------------------

resource "aws_bedrockagentcore_memory" "chat" {
  name                  = local.name
  description           = "Rapport chat history"
  event_expiry_duration = 7 # days
}

# --- Runtime role ------------------------------------------------------------------

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account]
    }
  }
}

resource "aws_iam_role" "runtime" {
  name               = "rapport-agent-${var.env}"
  assume_role_policy = data.aws_iam_policy_document.trust.json
}

data "aws_iam_policy_document" "runtime" {
  statement {
    sid       = "Code"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = ["${aws_s3_bucket.code.arn}/agent/*"]
  }
  statement {
    sid = "Logs"
    actions = [
      "logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents",
      "logs:DescribeLogStreams", "logs:DescribeLogGroups",
    ]
    resources = [
      "arn:aws:logs:${local.region}:${local.account}:log-group:/aws/bedrock-agentcore/runtimes/*",
      "arn:aws:logs:${local.region}:${local.account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*",
    ]
  }
  statement {
    sid = "Telemetry"
    actions = [
      "xray:PutTraceSegments", "xray:PutTelemetryRecords",
      "xray:GetSamplingRules", "xray:GetSamplingTargets", "cloudwatch:PutMetricData",
    ]
    resources = ["*"]
  }
  statement {
    sid = "WorkloadIdentity"
    actions = [
      "bedrock-agentcore:GetWorkloadAccessToken",
      "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
      "bedrock-agentcore:GetWorkloadAccessTokenForUserId",
    ]
    resources = [
      "arn:aws:bedrock-agentcore:${local.region}:${local.account}:workload-identity-directory/default",
      "arn:aws:bedrock-agentcore:${local.region}:${local.account}:workload-identity-directory/default/workload-identity/*",
    ]
  }
  statement {
    sid = "Memory"
    actions = [
      "bedrock-agentcore:CreateEvent", "bedrock-agentcore:GetEvent",
      "bedrock-agentcore:ListEvents", "bedrock-agentcore:ListSessions",
      "bedrock-agentcore:ListActors", "bedrock-agentcore:GetMemory",
      "bedrock-agentcore:RetrieveMemoryRecords", "bedrock-agentcore:ListMemoryRecords",
    ]
    resources = [aws_bedrockagentcore_memory.chat.arn]
  }
  # The US cross-region profile routes to the model in any US region.
  statement {
    sid     = "Claude"
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = [
      "arn:aws:bedrock:${local.region}:${local.account}:inference-profile/${var.model_id}",
      "arn:aws:bedrock:*::foundation-model/${trimprefix(var.model_id, "us.")}",
    ]
  }
  statement {
    sid = "Table"
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
      "dynamodb:Query", "dynamodb:BatchGetItem",
    ]
    resources = [var.table_arn, "${var.table_arn}/index/*"]
  }
  statement {
    sid       = "Photos"
    actions   = ["s3:GetObject"]
    resources = ["${var.photo_bucket_arn}/*"]
  }
  statement {
    sid = "PlaceSearch"
    actions = [
      "geo-places:Autocomplete", "geo-places:Geocode",
      "geo-places:GetPlace", "geo-places:ReverseGeocode",
    ]
    resources = ["arn:aws:geo-places:${local.region}::provider/default"]
  }
  statement {
    sid       = "TypeSafeKey"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:${local.region}:${local.account}:parameter${var.typesafe_key_param}"]
  }
  statement {
    sid       = "DecryptViaSsm"
    actions   = ["kms:Decrypt"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${local.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "runtime" {
  name   = "rapport-agent-${var.env}"
  role   = aws_iam_role.runtime.id
  policy = data.aws_iam_policy_document.runtime.json
}

# --- Runtime -----------------------------------------------------------------------

resource "aws_bedrockagentcore_agent_runtime" "chat" {
  agent_runtime_name = local.name
  description        = "Rapport chat assistant"
  role_arn           = aws_iam_role.runtime.arn

  agent_runtime_artifact {
    code_configuration {
      entry_point = ["main.py"]
      runtime     = "PYTHON_3_12"
      code {
        s3 {
          bucket = aws_s3_bucket.code.id
          prefix = aws_s3_object.code.key
          # A new version id is what rolls out a new build.
          version_id = aws_s3_object.code.version_id
        }
      }
    }
  }

  network_configuration {
    network_mode = "PUBLIC"
  }

  environment_variables = {
    RAPPORT_ENVIRONMENT        = var.env
    RAPPORT_TABLE_NAME         = var.table_name
    RAPPORT_PHOTO_BUCKET       = var.photo_bucket_name
    RAPPORT_AI_MODE            = "live"
    RAPPORT_GEO_MODE           = "live"
    RAPPORT_NOLA311_MODE       = "live"
    RAPPORT_TYPESAFE_KEY_PARAM = var.typesafe_key_param
    RAPPORT_AGENT_MEMORY_ID    = aws_bedrockagentcore_memory.chat.id
    RAPPORT_AGENT_MODEL        = var.model_id
  }

  depends_on = [aws_iam_role_policy.runtime]
}

output "runtime_arn" {
  value = aws_bedrockagentcore_agent_runtime.chat.agent_runtime_arn
}

output "memory_id" {
  value = aws_bedrockagentcore_memory.chat.id
}
