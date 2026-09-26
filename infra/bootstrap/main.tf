# One-time account bootstrap for Rapport.
# Creates the Terraform state bucket and the IAM roles used by GitHub Actions
# and by Claude Code. Applied locally by an admin; everything else in infra/
# is applied by CI through the roles defined here.

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # State lives in the bucket this stack creates. First apply runs with a local
  # backend, then `terraform init -migrate-state` moves it here (see README).
  backend "s3" {
    bucket       = "rapport-tfstate-322673434521"
    key          = "bootstrap/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "rapport"
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id   = data.aws_caller_identity.current.account_id
  state_bucket = "rapport-tfstate-${local.account_id}"
  # GitHub issues immutable subject claims for this repo, e.g.
  # repo:bshelling@3427089/rapport@1389535830:environment:prod
  sub_prefix = var.github_sub_prefix
}

# --- Terraform state bucket -------------------------------------------------

resource "aws_s3_bucket" "tfstate" {
  bucket = local.state_bucket

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# --- GitHub OIDC ------------------------------------------------------------

# The account already has the GitHub Actions OIDC provider; reuse it.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

# --- Shared policies --------------------------------------------------------

# Read/write the state objects (including the S3-native .tflock file).
data "aws_iam_policy_document" "tfstate_rw" {
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.tfstate.arn]
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.tfstate.arn}/*"]
  }
}

resource "aws_iam_policy" "tfstate_rw" {
  name   = "rapport-tfstate-rw"
  policy = data.aws_iam_policy_document.tfstate_rw.json
}

# PowerUserAccess excludes IAM. Deployers may manage only rapport-* IAM
# resources, which keeps them from escalating to account-wide admin.
data "aws_iam_policy_document" "scoped_iam" {
  statement {
    sid = "ManageRapportIam"
    actions = [
      "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateRole",
      "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole",
      "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy",
      "iam:ListRolePolicies", "iam:AttachRolePolicy", "iam:DetachRolePolicy",
      "iam:ListAttachedRolePolicies", "iam:ListInstanceProfilesForRole",
      "iam:CreatePolicy", "iam:DeletePolicy", "iam:GetPolicy",
      "iam:GetPolicyVersion", "iam:ListPolicyVersions",
      "iam:CreatePolicyVersion", "iam:DeletePolicyVersion",
      "iam:TagPolicy", "iam:UntagPolicy", "iam:PassRole",
    ]
    resources = [
      "arn:aws:iam::${local.account_id}:role/rapport-*",
      "arn:aws:iam::${local.account_id}:policy/rapport-*",
    ]
  }
  statement {
    sid       = "ServiceLinkedRoles"
    actions   = ["iam:CreateServiceLinkedRole"]
    resources = ["arn:aws:iam::${local.account_id}:role/aws-service-role/*"]
  }
  statement {
    sid       = "ReadIam"
    actions   = ["iam:List*", "iam:Get*"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "scoped_iam" {
  name   = "rapport-scoped-iam"
  policy = data.aws_iam_policy_document.scoped_iam.json
}

# --- GitHub Actions: plan role (pull requests, read-only) -------------------

data "aws_iam_policy_document" "gha_plan_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "${local.sub_prefix}:pull_request",
        "${local.sub_prefix}:ref:refs/heads/*",
      ]
    }
  }
}

resource "aws_iam_role" "gha_plan" {
  name                 = "rapport-gha-plan"
  assume_role_policy   = data.aws_iam_policy_document.gha_plan_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "gha_plan_readonly" {
  role       = aws_iam_role.gha_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_role_policy_attachment" "gha_plan_state" {
  role       = aws_iam_role.gha_plan.name
  policy_arn = aws_iam_policy.tfstate_rw.arn
}

# --- GitHub Actions: deploy role (main branch via the prod environment) -----

data "aws_iam_policy_document" "gha_deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${local.sub_prefix}:environment:prod"]
    }
  }
}

resource "aws_iam_role" "gha_deploy" {
  name                 = "rapport-gha-deploy"
  assume_role_policy   = data.aws_iam_policy_document.gha_deploy_trust.json
  max_session_duration = 3600
}

# --- Claude Code role (local agent sessions) --------------------------------

data "aws_iam_policy_document" "claude_code_trust" {
  statement {
    actions = ["sts:AssumeRole", "sts:SetSourceIdentity"]
    principals {
      type        = "AWS"
      identifiers = var.claude_code_trusted_principals
    }
  }
}

resource "aws_iam_role" "claude_code" {
  name                 = "rapport-claude-code"
  description          = "Assumed by Claude Code sessions building Rapport."
  assume_role_policy   = data.aws_iam_policy_document.claude_code_trust.json
  max_session_duration = 43200
}

# Deployers (CI and Claude Code) get the same permission set.
locals {
  deployer_roles = {
    gha_deploy  = aws_iam_role.gha_deploy.name
    claude_code = aws_iam_role.claude_code.name
  }
}

resource "aws_iam_role_policy_attachment" "deployer_poweruser" {
  for_each   = local.deployer_roles
  role       = each.value
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

resource "aws_iam_role_policy_attachment" "deployer_scoped_iam" {
  for_each   = local.deployer_roles
  role       = each.value
  policy_arn = aws_iam_policy.scoped_iam.arn
}

resource "aws_iam_role_policy_attachment" "deployer_state" {
  for_each   = local.deployer_roles
  role       = each.value
  policy_arn = aws_iam_policy.tfstate_rw.arn
}
