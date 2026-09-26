# Bootstrap

One-time, admin-applied stack that everything else depends on:

| Resource | Purpose |
|---|---|
| `rapport-tfstate-322673434521` | Terraform state (versioned, encrypted, S3-native locking) |
| `rapport-gha-plan` | GitHub Actions on PRs — `ReadOnlyAccess` + state access |
| `rapport-gha-deploy` | GitHub Actions in the `prod` environment (main only) — PowerUser + IAM limited to `rapport-*` |
| `rapport-claude-code` | Claude Code sessions (`AWS_PROFILE=rapport`) — same permissions as deploy; its CloudTrail activity is the hackathon agent-connection proof |

The account's existing GitHub OIDC provider is reused, not recreated.

## First-time apply

```sh
cd infra/bootstrap
printf 'terraform {\n  backend "local" {}\n}\n' > backend_override.tf
terraform init && terraform apply
rm backend_override.tf
terraform init -migrate-state -force-copy   # moves state into the bucket
rm -f terraform.tfstate terraform.tfstate.backup
```

After that, plain `terraform init && terraform plan` works against the S3 backend.

## Claude Code profile

```sh
aws configure set profile.rapport.role_arn arn:aws:iam::322673434521:role/rapport-claude-code
aws configure set profile.rapport.source_profile default
aws configure set profile.rapport.region us-east-1
aws configure set profile.rapport.role_session_name claude-code
```

`.mcp.json` points the AWS MCP servers at this profile.
