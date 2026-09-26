# Local development against MiniStack (docker compose up).
# Applies the same data module as prod so local and cloud schemas match.

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

variable "endpoint" {
  type    = string
  default = "http://localhost:4566"
}

provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true

  endpoints {
    dynamodb = var.endpoint
    s3       = var.endpoint
    sts      = var.endpoint
    iam      = var.endpoint
    ssm      = var.endpoint
  }
}

module "data" {
  source                 = "../../modules/data"
  env                    = "local"
  photo_bucket_name      = "rapport-photos-local"
  point_in_time_recovery = false
  cors_allowed_origins   = ["http://localhost:3000"]
}

output "table_name" {
  value = module.data.table_name
}

output "photo_bucket_name" {
  value = module.data.photo_bucket_name
}
