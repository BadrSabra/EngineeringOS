output "foundation_enabled" {
  description = "Whether Terraform is allowed to create the AWS foundation."
  value       = var.enable_foundation_resources
}

output "vpc_id" {
  description = "Preview VPC ID, null while the foundation is disabled."
  value       = try(aws_vpc.preview[0].id, null)
}

output "public_subnet_ids" {
  description = "Public subnets reserved for a future TLS Gateway."
  value       = [for subnet in aws_subnet.public : subnet.id]
}

output "private_subnet_ids" {
  description = "Private subnets reserved for per-session Fargate tasks."
  value       = [for subnet in aws_subnet.private : subnet.id]
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN for future preview task orchestration."
  value       = try(aws_ecs_cluster.preview[0].arn, null)
}

output "gateway_security_group_id" {
  description = "Security group reserved for the future signed-ticket Gateway."
  value       = try(aws_security_group.gateway[0].id, null)
}

output "runner_security_group_id" {
  description = "Private runner group; allows only the Gateway on preview_port."
  value       = try(aws_security_group.runner[0].id, null)
}

output "builder_security_group_id" {
  description = "Private Builder group with no ingress and only AWS endpoint/S3 egress."
  value       = try(aws_security_group.builder[0].id, null)
}

output "attestor_security_group_id" {
  description = "Isolated Attestor group with private endpoint and S3 access only."
  value       = try(aws_security_group.attestor[0].id, null)
}

output "vite_preview_repository_url" {
  description = "Immutable ECR repository URL for a future pinned Vite preview image."
  value       = try(aws_ecr_repository.vite_preview[0].repository_url, null)
}

output "vite_builder_repository_url" {
  description = "Immutable ECR repository URL for the isolated Preview Builder image."
  value       = try(aws_ecr_repository.vite_builder[0].repository_url, null)
}

output "vite_attestor_repository_url" {
  description = "Immutable ECR repository URL reserved for the signed receipt Attestor image."
  value       = try(aws_ecr_repository.vite_attestor[0].repository_url, null)
}

output "preview_artifact_bucket_name" {
  description = "Private short-lived storage bucket for signed Candidate build-input uploads."
  value       = try(aws_s3_bucket.preview_artifacts[0].bucket, null)
}

output "preview_log_group_name" {
  description = "Bounded-retention CloudWatch log group for future preview runtime logs."
  value       = try(aws_cloudwatch_log_group.preview[0].name, null)
}

output "gateway_execution_role_arn" {
  description = "Execution role for pulling and logging the future Gateway task image."
  value       = try(aws_iam_role.gateway_execution[0].arn, null)
}

output "gateway_control_role_arn" {
  description = "Least-privilege task role for signed ECS start/stop commands."
  value       = try(aws_iam_role.gateway_control[0].arn, null)
}

output "runner_execution_role_arn" {
  description = "Execution role allowed on per-Candidate Vite preview task definitions."
  value       = try(aws_iam_role.runner_execution[0].arn, null)
}

output "builder_execution_role_arn" {
  description = "Execution-only role for pulling and logging the Builder task image."
  value       = try(aws_iam_role.builder_execution[0].arn, null)
}

output "attestor_execution_role_arn" {
  description = "Execution role limited to logs, the command envelope, and receipt-signing secret."
  value       = try(aws_iam_role.attestor_execution[0].arn, null)
}

output "attestor_task_role_arn" {
  description = "Attestor task role limited to ECS inspection and scoped artifact read/receipt write."
  value       = try(aws_iam_role.attestor_task[0].arn, null)
}

output "attestor_signing_secret_arn" {
  description = "Secrets Manager ARN only; secret value is provisioned separately by the operator."
  value       = try(aws_secretsmanager_secret.preview_attestor_signing_key[0].arn, null)
}

output "preview_command_fence_table_name" {
  description = "DynamoDB table used only to fence signed command versions."
  value       = try(aws_dynamodb_table.preview_command_fence[0].name, null)
}

output "preview_builder_job_fence_table_name" {
  description = "DynamoDB table that permits each signed Builder job ID to launch once."
  value       = try(aws_dynamodb_table.preview_builder_job_fence[0].name, null)
}

output "preview_attestor_job_fence_table_name" {
  description = "DynamoDB fence table for idempotent Attestor task launches."
  value       = try(aws_dynamodb_table.preview_attestor_job_fence[0].name, null)
}

output "preview_task_definition_arn_prefix" {
  description = "Allowed task-definition family prefix; no Candidate definition is registered by this template."
  value       = local.preview_task_definition_arn_prefix
}

output "builder_task_definition_arn_prefix" {
  description = "Allowed Builder task-definition family; task definitions are registered by a separate reviewed release."
  value       = local.builder_task_definition_arn_prefix
}

output "attestor_task_definition_arn_prefix" {
  description = "Allowed Attestor task-definition family; task definitions are registered by a separate reviewed release."
  value       = local.attestor_task_definition_arn_prefix
}

output "attestor_task_definition_arn" {
  description = "Exact registered Attestor task definition ARN, null until both images and the public verification key are pinned."
  value       = try(aws_ecs_task_definition.attestor[0].arn, null)
}

output "attestor_image_digest" {
  description = "Pinned Attestor image digest used by its registered task definition."
  value       = var.preview_attestor_image_digest
}

output "builder_task_definition_arn" {
  description = "Exact registered Builder task definition ARN, or the configured external ARN when Terraform registration is disabled."
  value       = local.configured_builder_task_definition_arn != "" ? local.configured_builder_task_definition_arn : null
}

output "builder_image_digest" {
  description = "Pinned Builder image digest used by Attestor verification."
  value       = var.preview_builder_image_digest
}
