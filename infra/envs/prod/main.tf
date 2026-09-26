terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "s3" {
    bucket       = "rapport-tfstate-322673434521"
    key          = "prod/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}

variable "api_zip_path" {
  description = "Lambda package from scripts/build-api-zip.sh."
  type        = string
  default     = "../../../dist/api.zip"
}

variable "app_version" {
  description = "Deployed version (git SHA in CI)."
  type        = string
  default     = "dev"
}

locals {
  env        = "prod"
  account_id = data.aws_caller_identity.current.account_id
}

provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "rapport"
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

module "data" {
  source            = "../../modules/data"
  env               = local.env
  photo_bucket_name = "rapport-photos-${local.env}-${local.account_id}"
}

module "auth" {
  source        = "../../modules/auth"
  env           = local.env
  domain_prefix = "rapport-nola-${local.env}"
  app_urls      = [module.web.site_url, "http://localhost:3000"]
}

module "api" {
  source            = "../../modules/api"
  env               = local.env
  zip_path          = var.api_zip_path
  app_version       = var.app_version
  table_name        = module.data.table_name
  table_arn         = module.data.table_arn
  photo_bucket_name = module.data.photo_bucket_name
  photo_bucket_arn  = module.data.photo_bucket_arn
  jwt_issuer        = module.auth.issuer
  jwt_audience      = [module.auth.client_id]
}

module "web" {
  source           = "../../modules/web"
  env              = local.env
  site_bucket_name = "rapport-site-${local.env}-${local.account_id}"
  api_endpoint     = module.api.api_endpoint
}

output "site_url" {
  value = module.web.site_url
}

output "site_bucket" {
  value = module.web.site_bucket
}

output "distribution_id" {
  value = module.web.distribution_id
}

output "api_endpoint" {
  value = module.api.api_endpoint
}

output "user_pool_id" {
  value = module.auth.user_pool_id
}

output "user_pool_client_id" {
  value = module.auth.client_id
}

output "auth_domain" {
  value = module.auth.domain
}

output "table_name" {
  value = module.data.table_name
}
