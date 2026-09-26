# Rapport data layer: the single DynamoDB table and the photo bucket.
# Also applied against MiniStack for local development (infra/envs/local).

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

variable "photo_bucket_name" {
  type = string
}

variable "point_in_time_recovery" {
  description = "Enable DynamoDB PITR (off for local emulators)."
  type        = bool
  default     = true
}

variable "cors_allowed_origins" {
  description = "Origins allowed to PUT photos with presigned URLs."
  type        = list(string)
  default     = ["*"]
}

# Single-table design (NoSQL Workbench model: docs/dynamodb/rapport.workbench.json).
#   PK/SK         entity keys (USER#, REPORT#, DRAFT#, NOLA311#, BASIN#, STATS#)
#   GSI1PK/GSI1SK reports by user, newest first (dashboard)
#   GSI2PK/GSI2SK geohash cell -> type#date (map, duplicate detection)
resource "aws_dynamodb_table" "main" {
  name         = "rapport-${var.env}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  attribute {
    name = "GSI1PK"
    type = "S"
  }
  attribute {
    name = "GSI1SK"
    type = "S"
  }
  attribute {
    name = "GSI2PK"
    type = "S"
  }
  attribute {
    name = "GSI2SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    projection_type = "ALL"
    key_schema {
      attribute_name = "GSI1PK"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "GSI1SK"
      key_type       = "RANGE"
    }
  }

  global_secondary_index {
    name            = "GSI2"
    projection_type = "ALL"
    key_schema {
      attribute_name = "GSI2PK"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "GSI2SK"
      key_type       = "RANGE"
    }
  }

  # Drafts and rate-limit counters expire automatically.
  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = var.point_in_time_recovery
  }
}

resource "aws_s3_bucket" "photos" {
  bucket = var.photo_bucket_name
}

resource "aws_s3_bucket_public_access_block" "photos" {
  bucket                  = aws_s3_bucket.photos.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id
  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = var.cors_allowed_origins
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id
  rule {
    id     = "expire-abandoned-draft-uploads"
    status = "Enabled"
    filter {
      prefix = "drafts/"
    }
    expiration {
      days = 7
    }
  }
}

output "table_name" {
  value = aws_dynamodb_table.main.name
}

output "table_arn" {
  value = aws_dynamodb_table.main.arn
}

output "photo_bucket_name" {
  value = aws_s3_bucket.photos.bucket
}

output "photo_bucket_arn" {
  value = aws_s3_bucket.photos.arn
}
