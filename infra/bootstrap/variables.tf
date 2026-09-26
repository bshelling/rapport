variable "region" {
  type    = string
  default = "us-east-1"
}

variable "github_sub_prefix" {
  description = "OIDC sub-claim prefix for the repo (gh api repos/OWNER/REPO/actions/oidc/customization/sub)."
  type        = string
  default     = "repo:bshelling@3427089/rapport@1389535830"
}

variable "claude_code_trusted_principals" {
  description = "IAM principals allowed to assume the rapport-claude-code role."
  type        = list(string)
  default     = ["arn:aws:iam::322673434521:user/gusoadmin"]
}
