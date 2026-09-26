# Cognito user pool with managed login (hosted UI) for Rapport residents.
# The web app signs in with the authorization-code + PKCE flow; API Gateway
# validates the resulting ID token (see modules/api).

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
}

variable "env" {
  type = string
}

variable "domain_prefix" {
  description = "Managed login domain prefix (<prefix>.auth.<region>.amazoncognito.com)."
  type        = string
}

variable "app_urls" {
  description = "Origins of the web app (sign-in callbacks and sign-out redirects are derived from these)."
  type        = list(string)
}

variable "create_e2e_user" {
  description = "Create a pre-verified test user whose password is stored in SSM, for Playwright."
  type        = bool
  default     = true
}

data "aws_region" "current" {}

resource "aws_cognito_user_pool" "main" {
  name                     = "rapport-${var.env}"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = "ACTIVE"
  mfa_configuration        = "OFF"

  username_configuration {
    case_sensitive = false
  }

  password_policy {
    minimum_length                   = 10
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Your Rapport verification code"
    email_message        = "Your Rapport verification code is {####}."
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true
    string_attribute_constraints {
      min_length = 3
      max_length = 254
    }
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "rapport-web-${var.env}"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = [for u in var.app_urls : "${u}/auth/callback/"]
  logout_urls                          = [for u in var.app_urls : "${u}/"]

  # USER_PASSWORD_AUTH is not enabled; SRP covers the admin/test tooling.
  explicit_auth_flows           = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  id_token_validity      = 60
  access_token_validity  = 60
  refresh_token_validity = 30
  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_domain" "main" {
  domain                = var.domain_prefix
  user_pool_id          = aws_cognito_user_pool.main.id
  managed_login_version = 2
}

resource "aws_cognito_managed_login_branding" "web" {
  user_pool_id                = aws_cognito_user_pool.main.id
  client_id                   = aws_cognito_user_pool_client.web.id
  use_cognito_provided_values = true
}

# --- Playwright test user ---------------------------------------------------

resource "random_password" "e2e" {
  count            = var.create_e2e_user ? 1 : 0
  length           = 24
  min_upper        = 2
  min_lower        = 2
  min_numeric      = 2
  special          = false
  override_special = ""
}

resource "aws_cognito_user" "e2e" {
  count        = var.create_e2e_user ? 1 : 0
  user_pool_id = aws_cognito_user_pool.main.id
  username     = "e2e@example.com"
  password     = random_password.e2e[0].result

  # Suppress the welcome email; the address is not deliverable.
  message_action = "SUPPRESS"
  attributes = {
    email          = "e2e@example.com"
    email_verified = "true"
  }
}

resource "aws_ssm_parameter" "e2e_password" {
  count = var.create_e2e_user ? 1 : 0
  name  = "/rapport/${var.env}/e2e/password"
  type  = "SecureString"
  value = random_password.e2e[0].result
}

output "user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.main.arn
}

output "client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "issuer" {
  value = "https://cognito-idp.${data.aws_region.current.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}

output "domain" {
  value = "${aws_cognito_user_pool_domain.main.domain}.auth.${data.aws_region.current.region}.amazoncognito.com"
}
