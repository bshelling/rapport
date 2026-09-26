variable "region" {
  type    = string
  default = "us-east-1"
}

variable "github_owner" {
  type    = string
  default = "bshelling"
}

variable "github_repo" {
  type    = string
  default = "rapport"
}

variable "claude_code_trusted_principals" {
  description = "IAM principals allowed to assume the rapport-claude-code role."
  type        = list(string)
  default     = ["arn:aws:iam::322673434521:user/gusoadmin"]
}
