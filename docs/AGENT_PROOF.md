# Coding agent ↔ AWS connection proof

Rapport was built with **Claude Code** connected to AWS account `322673434521` (us-east-1).

## How the agent connects

1. **Dedicated IAM role** `rapport-claude-code` (defined in [`infra/bootstrap`](../infra/bootstrap/main.tf)), assumed through the `rapport` AWS CLI profile with session name `claude-code`. Every API call the agent makes is attributable in CloudTrail to `assumed-role/rapport-claude-code/claude-code`.
2. **AWS MCP servers** configured in [`.mcp.json`](../.mcp.json) — `awslabs.aws-api-mcp-server`, `awslabs.terraform-mcp-server`, `awslabs.amazon-bedrock-agentcore-mcp-server` — all running under the same profile.
3. **AWS CLI + Terraform** invoked directly by the agent from the terminal.

## Log

### 2026-09-26 — Bootstrap (PR `infra/bootstrap`)

Claude Code planned and applied the bootstrap stack, migrated its state to S3, and verified the new role:

```
$ terraform apply boot.tfplan
Apply complete! Resources: 18 added, 0 changed, 0 destroyed.

$ aws sts get-caller-identity --profile rapport
{
    "UserId": "AROAUWIGV36M4HW7CPNYX:claude-code",
    "Account": "322673434521",
    "Arn": "arn:aws:sts::322673434521:assumed-role/rapport-claude-code/claude-code"
}
```

It then verified least-privilege scoping with the IAM policy simulator (`iam:CreateRole` allowed only for `rapport-*`; `iam:CreateUser` denied; plan role read-only).

<!-- Further entries (screenshots, CloudTrail lookups, deploy logs) are appended per PR. -->
