locals {
  enabled = var.enable_foundation_resources

  public_subnets  = local.enabled ? var.public_subnet_cidrs : {}
  private_subnets = local.enabled ? var.private_subnet_cidrs : {}

  interface_services = toset([
    "ecr.api",
    "ecr.dkr",
    "ecs",
    "logs",
    "secretsmanager",
  ])

  preview_task_definition_arn_prefix  = local.enabled ? "arn:${data.aws_partition.current[0].partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current[0].account_id}:task-definition/${var.name_prefix}-vite-preview:" : ""
  preview_task_definition_arn         = local.enabled ? "${local.preview_task_definition_arn_prefix}*" : ""
  builder_task_definition_arn_prefix  = local.enabled ? "arn:${data.aws_partition.current[0].partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current[0].account_id}:task-definition/${var.name_prefix}-vite-builder:" : ""
  builder_task_definition_arn         = local.enabled ? "${local.builder_task_definition_arn_prefix}*" : ""
  attestor_task_definition_arn_prefix = local.enabled ? "arn:${data.aws_partition.current[0].partition}:ecs:${var.aws_region}:${data.aws_caller_identity.current[0].account_id}:task-definition/${var.name_prefix}-vite-attestor:" : ""
  attestor_task_definition_arn        = local.enabled ? "${local.attestor_task_definition_arn_prefix}*" : ""
  builder_task_definition_enabled = (
    local.enabled &&
    var.preview_builder_task_definition_arn == "" &&
    var.preview_builder_image_digest != "" &&
    var.preview_build_job_public_key_pem != ""
  )
  configured_builder_task_definition_arn = local.builder_task_definition_enabled ? aws_ecs_task_definition.builder[0].arn : var.preview_builder_task_definition_arn
  attestor_task_definition_enabled = (
    local.enabled &&
    var.preview_attestor_image_digest != "" &&
    local.configured_builder_task_definition_arn != "" &&
    var.preview_builder_image_digest != "" &&
    var.preview_build_job_public_key_pem != ""
  )

  common_tags = merge(var.tags, {
    ManagedBy = "Terraform"
    Product   = "EngineeringOS Preview"
  })
}

data "aws_partition" "current" {
  count = local.enabled ? 1 : 0
}

data "aws_caller_identity" "current" {
  count = local.enabled ? 1 : 0
}

data "aws_prefix_list" "s3" {
  count = local.enabled ? 1 : 0
  name  = "com.amazonaws.${var.aws_region}.s3"
}

data "aws_prefix_list" "dynamodb" {
  count = local.enabled ? 1 : 0
  name  = "com.amazonaws.${var.aws_region}.dynamodb"
}

resource "aws_vpc" "preview" {
  count                = local.enabled ? 1 : 0
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = merge(local.common_tags, { Name = "${var.name_prefix}-vpc" })

  lifecycle {
    precondition {
      condition = (
        trimspace(var.aws_region) != "" &&
        length(var.public_subnet_cidrs) == 2 &&
        length(var.private_subnet_cidrs) == 2 &&
        trimspace(var.ecr_layer_bucket_arn) != "" &&
        toset(keys(var.public_subnet_cidrs)) == toset(keys(var.private_subnet_cidrs)) &&
        length(toset(concat(
          values(var.public_subnet_cidrs),
          values(var.private_subnet_cidrs),
        ))) == 4
      )
      error_message = "Enablement requires an ECR layer bucket ARN and two distinct public and private subnet CIDRs in the same two Availability Zones."
    }
  }
}

resource "aws_internet_gateway" "preview" {
  count  = local.enabled ? 1 : 0
  vpc_id = aws_vpc.preview[0].id
  tags   = merge(local.common_tags, { Name = "${var.name_prefix}-igw" })
}

resource "aws_subnet" "public" {
  for_each = local.public_subnets

  vpc_id                  = aws_vpc.preview[0].id
  availability_zone       = each.key
  cidr_block              = each.value
  map_public_ip_on_launch = false
  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-public-${each.key}"
    Tier = "public-gateway"
  })
}

resource "aws_subnet" "private" {
  for_each = local.private_subnets

  vpc_id                  = aws_vpc.preview[0].id
  availability_zone       = each.key
  cidr_block              = each.value
  map_public_ip_on_launch = false
  tags = merge(local.common_tags, {
    Name = "${var.name_prefix}-private-${each.key}"
    Tier = "preview-task"
  })
}

resource "aws_route_table" "public" {
  count  = local.enabled ? 1 : 0
  vpc_id = aws_vpc.preview[0].id
  tags   = merge(local.common_tags, { Name = "${var.name_prefix}-public" })
}

resource "aws_route" "public_internet" {
  count                  = local.enabled ? 1 : 0
  route_table_id         = aws_route_table.public[0].id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.preview[0].id
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public[0].id
}

resource "aws_route_table" "private" {
  for_each = local.private_subnets

  vpc_id = aws_vpc.preview[0].id
  tags   = merge(local.common_tags, { Name = "${var.name_prefix}-private-${each.key}" })
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private[each.key].id
}

resource "aws_security_group" "gateway" {
  count       = local.enabled ? 1 : 0
  name        = "${var.name_prefix}-gateway"
  description = "Future signed-ticket Gateway; public ingress is not configured by this foundation."
  vpc_id      = aws_vpc.preview[0].id
  ingress     = []
  egress      = []
  tags        = merge(local.common_tags, { Name = "${var.name_prefix}-gateway" })
}

resource "aws_security_group" "runner" {
  count       = local.enabled ? 1 : 0
  name        = "${var.name_prefix}-runner"
  description = "Private static preview tasks; only the Gateway may reach the fixed app port."
  vpc_id      = aws_vpc.preview[0].id
  ingress     = []
  egress      = []
  tags        = merge(local.common_tags, { Name = "${var.name_prefix}-runner" })
}

resource "aws_security_group" "builder" {
  count       = local.enabled ? 1 : 0
  name        = "${var.name_prefix}-builder"
  description = "Isolated, non-listening Builder tasks with AWS endpoint and S3 egress only."
  vpc_id      = aws_vpc.preview[0].id
  ingress     = []
  egress      = []
  tags        = merge(local.common_tags, { Name = "${var.name_prefix}-builder" })
}

resource "aws_security_group" "attestor" {
  count       = local.enabled ? 1 : 0
  name        = "${var.name_prefix}-attestor"
  description = "Isolated receipt signer with only private ECS, Secrets Manager, and S3 access."
  vpc_id      = aws_vpc.preview[0].id
  ingress     = []
  egress      = []
  tags        = merge(local.common_tags, { Name = "${var.name_prefix}-attestor" })
}

resource "aws_security_group" "endpoints" {
  count       = local.enabled ? 1 : 0
  name        = "${var.name_prefix}-endpoints"
  description = "Private AWS endpoint ingress from Gateway, preview, Builder, and Attestor tasks."
  vpc_id      = aws_vpc.preview[0].id
  ingress     = []
  egress      = []
  tags        = merge(local.common_tags, { Name = "${var.name_prefix}-endpoints" })
}

resource "aws_security_group" "gateway_ecs_endpoint" {
  count       = local.enabled ? 1 : 0
  name        = "${var.name_prefix}-gateway-ecs-endpoint"
  description = "ECS control-plane endpoint reachable only by Gateway and read-only Attestor."
  vpc_id      = aws_vpc.preview[0].id
  ingress     = []
  egress      = []
  tags        = merge(local.common_tags, { Name = "${var.name_prefix}-gateway-ecs-endpoint" })
}

resource "aws_vpc_security_group_ingress_rule" "endpoint_https" {
  for_each = local.enabled ? {
    gateway  = aws_security_group.gateway[0].id
    runner   = aws_security_group.runner[0].id
    builder  = aws_security_group.builder[0].id
    attestor = aws_security_group.attestor[0].id
  } : {}

  security_group_id            = aws_security_group.endpoints[0].id
  referenced_security_group_id = each.value
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "HTTPS from ${each.key} to private AWS endpoints."
}

resource "aws_vpc_security_group_ingress_rule" "gateway_ecs_endpoint_https" {
  count                        = local.enabled ? 1 : 0
  security_group_id            = aws_security_group.gateway_ecs_endpoint[0].id
  referenced_security_group_id = aws_security_group.gateway[0].id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "ECS control API from the Gateway only."
}

resource "aws_vpc_security_group_ingress_rule" "attestor_ecs_endpoint_https" {
  count                        = local.enabled ? 1 : 0
  security_group_id            = aws_security_group.gateway_ecs_endpoint[0].id
  referenced_security_group_id = aws_security_group.attestor[0].id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "Attestor read-only ECS task identity checks."
}

resource "aws_vpc_security_group_egress_rule" "gateway_runner" {
  count                        = local.enabled ? 1 : 0
  security_group_id            = aws_security_group.gateway[0].id
  referenced_security_group_id = aws_security_group.runner[0].id
  from_port                    = var.preview_port
  to_port                      = var.preview_port
  ip_protocol                  = "tcp"
  description                  = "Gateway to the fixed static preview port."
}

resource "aws_vpc_security_group_ingress_rule" "runner_gateway" {
  count                        = local.enabled ? 1 : 0
  security_group_id            = aws_security_group.runner[0].id
  referenced_security_group_id = aws_security_group.gateway[0].id
  from_port                    = var.preview_port
  to_port                      = var.preview_port
  ip_protocol                  = "tcp"
  description                  = "Only the Gateway may reach a preview task."
}

resource "aws_vpc_security_group_egress_rule" "service_endpoints" {
  for_each = local.enabled ? {
    gateway  = aws_security_group.gateway[0].id
    runner   = aws_security_group.runner[0].id
    builder  = aws_security_group.builder[0].id
    attestor = aws_security_group.attestor[0].id
  } : {}

  security_group_id            = each.value
  referenced_security_group_id = aws_security_group.endpoints[0].id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "HTTPS only to private AWS endpoint interfaces."
}

resource "aws_vpc_security_group_egress_rule" "service_s3" {
  for_each = local.enabled ? {
    gateway  = aws_security_group.gateway[0].id
    runner   = aws_security_group.runner[0].id
    builder  = aws_security_group.builder[0].id
    attestor = aws_security_group.attestor[0].id
  } : {}

  security_group_id = each.value
  prefix_list_id    = data.aws_prefix_list.s3[0].id
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "HTTPS only to regional S3 for ECR layers and scoped Preview build transfers."
}

resource "aws_vpc_security_group_egress_rule" "gateway_ecs_endpoint" {
  count                        = local.enabled ? 1 : 0
  security_group_id            = aws_security_group.gateway[0].id
  referenced_security_group_id = aws_security_group.gateway_ecs_endpoint[0].id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "HTTPS to the private ECS control-plane endpoint."
}

resource "aws_vpc_security_group_egress_rule" "attestor_ecs_endpoint" {
  count                        = local.enabled ? 1 : 0
  security_group_id            = aws_security_group.attestor[0].id
  referenced_security_group_id = aws_security_group.gateway_ecs_endpoint[0].id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  description                  = "Attestor read-only access to the private ECS control plane."
}

resource "aws_vpc_security_group_egress_rule" "gateway_dynamodb" {
  count             = local.enabled ? 1 : 0
  security_group_id = aws_security_group.gateway[0].id
  prefix_list_id    = data.aws_prefix_list.dynamodb[0].id
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "HTTPS to the DynamoDB command-fence endpoint."
}

resource "aws_vpc_endpoint" "interface" {
  for_each = local.enabled ? local.interface_services : toset([])

  vpc_id              = aws_vpc.preview[0].id
  service_name        = "com.amazonaws.${var.aws_region}.${each.value}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = [for subnet in aws_subnet.private : subnet.id]
  security_group_ids = each.value == "ecs" ? [
    aws_security_group.gateway_ecs_endpoint[0].id,
    ] : [
    aws_security_group.endpoints[0].id,
  ]
  tags = merge(local.common_tags, { Name = "${var.name_prefix}-${replace(each.value, ".", "-")}" })
}

resource "aws_vpc_endpoint" "s3" {
  count             = local.enabled ? 1 : 0
  vpc_id            = aws_vpc.preview[0].id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [for route_table in aws_route_table.private : route_table.id]
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowEcrLayerReadsOnly"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:GetObject"]
        Resource  = ["${var.ecr_layer_bucket_arn}/*"]
      },
      {
        Sid       = "AllowPreviewBuildInputObjects"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:GetObject", "s3:PutObject"]
        Resource  = ["${aws_s3_bucket.preview_artifacts[0].arn}/build-inputs/*"]
      },
      {
        Sid       = "AllowPreviewBuildOutputObjects"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:GetObject", "s3:PutObject"]
        Resource  = ["${aws_s3_bucket.preview_artifacts[0].arn}/preview-build-outputs/*"]
      },
      {
        Sid       = "AllowBuilderJobEnvelopeObjects"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:GetObject", "s3:PutObject"]
        Resource  = ["${aws_s3_bucket.preview_artifacts[0].arn}/builder-job-envelopes/*"]
      },
      {
        Sid       = "AllowAttestorCommandEnvelopeReads"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:GetObject", "s3:PutObject"]
        Resource  = ["${aws_s3_bucket.preview_artifacts[0].arn}/attestor-command-envelopes/*"]
      },
      {
        Sid       = "AllowAttestorReceiptObjects"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:GetObject", "s3:PutObject"]
        Resource  = ["${aws_s3_bucket.preview_artifacts[0].arn}/preview-build-receipts/*"]
      },
      {
        Sid       = "ListAttestorReceiptPrefix"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:ListBucket"]
        Resource  = [aws_s3_bucket.preview_artifacts[0].arn]
        Condition = {
          StringLike = {
            "s3:prefix" = ["preview-build-receipts/*"]
          }
        }
      },
    ]
  })
  tags = merge(local.common_tags, { Name = "${var.name_prefix}-s3-preview-artifacts" })
}

resource "aws_dynamodb_table" "preview_command_fence" {
  count                       = local.enabled ? 1 : 0
  name                        = "${var.name_prefix}-command-fence"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "session_id"
  deletion_protection_enabled = true

  attribute {
    name = "session_id"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at_epoch"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = merge(local.common_tags, {
    Name    = "${var.name_prefix}-command-fence"
    Purpose = "Preview command replay fence"
  })
}

resource "aws_dynamodb_table" "preview_builder_job_fence" {
  count                       = local.enabled ? 1 : 0
  name                        = "${var.name_prefix}-builder-job-fence"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "job_id"
  deletion_protection_enabled = true

  attribute {
    name = "job_id"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at_epoch"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = merge(local.common_tags, {
    Name    = "${var.name_prefix}-builder-job-fence"
    Purpose = "One-time Preview Builder launch fence"
  })
}

resource "aws_dynamodb_table" "preview_attestor_job_fence" {
  count                       = local.enabled ? 1 : 0
  name                        = "${var.name_prefix}-attestor-job-fence"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "job_id"
  deletion_protection_enabled = true

  attribute {
    name = "job_id"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at_epoch"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = merge(local.common_tags, {
    Name    = "${var.name_prefix}-attestor-job-fence"
    Purpose = "One-time Preview Attestor launch fence"
  })
}

resource "aws_vpc_endpoint" "dynamodb" {
  count             = local.enabled ? 1 : 0
  vpc_id            = aws_vpc.preview[0].id
  service_name      = "com.amazonaws.${var.aws_region}.dynamodb"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [for route_table in aws_route_table.private : route_table.id]
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = "*"
      Action    = ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:PutItem"]
      Resource = [
        aws_dynamodb_table.preview_command_fence[0].arn,
        aws_dynamodb_table.preview_builder_job_fence[0].arn,
        aws_dynamodb_table.preview_attestor_job_fence[0].arn,
      ]
    }]
  })
  tags = merge(local.common_tags, { Name = "${var.name_prefix}-dynamodb-fence" })
}

resource "aws_ecr_repository" "vite_preview" {
  count                = local.enabled ? 1 : 0
  name                 = "${var.name_prefix}-vite-preview"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  tags                 = merge(local.common_tags, { Name = "${var.name_prefix}-vite-preview" })

  encryption_configuration {
    encryption_type = "AES256"
  }

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "vite_builder" {
  count                = local.enabled ? 1 : 0
  name                 = "${var.name_prefix}-vite-builder"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  tags                 = merge(local.common_tags, { Name = "${var.name_prefix}-vite-builder" })

  encryption_configuration {
    encryption_type = "AES256"
  }

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "vite_attestor" {
  count                = local.enabled ? 1 : 0
  name                 = "${var.name_prefix}-vite-attestor"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  tags                 = merge(local.common_tags, { Name = "${var.name_prefix}-vite-attestor" })

  encryption_configuration {
    encryption_type = "AES256"
  }

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_secretsmanager_secret" "preview_attestor_signing_key" {
  count                   = local.enabled ? 1 : 0
  name                    = "${var.name_prefix}/attestor/receipt-signing-key"
  recovery_window_in_days = 7
  tags = merge(local.common_tags, {
    Name    = "${var.name_prefix}-attestor-signing-key"
    Purpose = "Private Ed25519 signing key used only by the isolated Attestor task"
  })
}

resource "aws_s3_bucket" "preview_artifacts" {
  count         = local.enabled ? 1 : 0
  bucket_prefix = "${var.name_prefix}-artifacts-"
  force_destroy = false
  tags          = merge(local.common_tags, { Name = "${var.name_prefix}-artifacts" })
}

resource "aws_s3_bucket_public_access_block" "preview_artifacts" {
  count                   = local.enabled ? 1 : 0
  bucket                  = aws_s3_bucket.preview_artifacts[0].id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "preview_artifacts" {
  count  = local.enabled ? 1 : 0
  bucket = aws_s3_bucket.preview_artifacts[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource = [
        aws_s3_bucket.preview_artifacts[0].arn,
        "${aws_s3_bucket.preview_artifacts[0].arn}/*",
      ]
      Condition = {
        Bool = { "aws:SecureTransport" = "false" }
      }
    }]
  })
}

resource "aws_s3_bucket_ownership_controls" "preview_artifacts" {
  count  = local.enabled ? 1 : 0
  bucket = aws_s3_bucket.preview_artifacts[0].id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "preview_artifacts" {
  count  = local.enabled ? 1 : 0
  bucket = aws_s3_bucket.preview_artifacts[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "preview_artifacts" {
  count  = local.enabled ? 1 : 0
  bucket = aws_s3_bucket.preview_artifacts[0].id

  rule {
    id     = "expire-build-inputs"
    status = "Enabled"

    filter {
      prefix = "build-inputs/"
    }

    expiration {
      days = 1
    }
  }

  rule {
    id     = "expire-build-outputs"
    status = "Enabled"

    filter {
      prefix = "preview-build-outputs/"
    }

    expiration {
      days = 1
    }
  }

  rule {
    id     = "expire-builder-job-envelopes"
    status = "Enabled"

    filter {
      prefix = "builder-job-envelopes/"
    }

    expiration {
      days = 1
    }
  }

  rule {
    id     = "expire-attestor-command-envelopes"
    status = "Enabled"

    filter {
      prefix = "attestor-command-envelopes/"
    }

    expiration {
      days = 1
    }
  }

  rule {
    id     = "expire-preview-build-receipts"
    status = "Enabled"

    filter {
      prefix = "preview-build-receipts/"
    }

    expiration {
      days = 1
    }
  }
}

resource "aws_ecs_cluster" "preview" {
  count = local.enabled ? 1 : 0
  name  = "${var.name_prefix}-cluster"
  tags  = merge(local.common_tags, { Name = "${var.name_prefix}-cluster" })
}

resource "aws_cloudwatch_log_group" "preview" {
  count             = local.enabled ? 1 : 0
  name              = "/engineeringos/preview/vite"
  retention_in_days = var.log_retention_days
  tags              = merge(local.common_tags, { Name = "${var.name_prefix}-vite-logs" })
}

resource "aws_ecs_task_definition" "builder" {
  count                    = local.builder_task_definition_enabled ? 1 : 0
  family                   = "${var.name_prefix}-vite-builder"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = aws_iam_role.builder_execution[0].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  volume {
    name = "builder-tmp"
  }

  container_definitions = jsonencode([
    {
      name                   = "builder"
      image                  = "${aws_ecr_repository.vite_builder[0].repository_url}@${var.preview_builder_image_digest}"
      essential              = true
      user                   = "10001:10001"
      readonlyRootFilesystem = true
      privileged             = false
      linuxParameters = {
        capabilities = {
          drop = ["ALL"]
        }
      }
      environment = [
        { name = "AWS_REGION", value = var.aws_region },
        { name = "PREVIEW_S3_BUCKET", value = aws_s3_bucket.preview_artifacts[0].bucket },
        { name = "PREVIEW_BUILD_JOB_PUBLIC_KEY_PEM", value = replace(var.preview_build_job_public_key_pem, "\\n", "\n") },
      ]
      mountPoints = [
        {
          sourceVolume  = "builder-tmp"
          containerPath = "/tmp"
          readOnly      = false
        },
      ]
      secrets          = []
      environmentFiles = []
      portMappings     = []
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.preview[0].name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "builder"
        }
      }
    },
  ])

  tags = merge(local.common_tags, {
    Name    = "${var.name_prefix}-vite-builder"
    Purpose = "Isolated Vite/React static build"
  })

  depends_on = [
    aws_iam_role_policy.builder_envelope,
    aws_iam_role_policy_attachment.builder_execution,
  ]
}

resource "aws_ecs_task_definition" "attestor" {
  count                    = local.attestor_task_definition_enabled ? 1 : 0
  family                   = "${var.name_prefix}-vite-attestor"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.attestor_execution[0].arn
  task_role_arn            = aws_iam_role.attestor_task[0].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name                   = "attestor"
      image                  = "${aws_ecr_repository.vite_attestor[0].repository_url}@${var.preview_attestor_image_digest}"
      essential              = true
      user                   = "10001:10001"
      readonlyRootFilesystem = true
      privileged             = false
      linuxParameters = {
        capabilities = {
          drop = ["ALL"]
        }
      }
      environment = [
        { name = "AWS_REGION", value = var.aws_region },
        { name = "PREVIEW_S3_BUCKET", value = aws_s3_bucket.preview_artifacts[0].bucket },
        { name = "PREVIEW_ECS_CLUSTER_ARN", value = aws_ecs_cluster.preview[0].arn },
        { name = "PREVIEW_BUILDER_TASK_DEFINITION_ARN", value = local.configured_builder_task_definition_arn },
        { name = "PREVIEW_BUILDER_ECR_REPOSITORY_URI", value = aws_ecr_repository.vite_builder[0].repository_url },
        { name = "PREVIEW_BUILDER_IMAGE_DIGEST", value = var.preview_builder_image_digest },
        { name = "PREVIEW_BUILDER_EXECUTION_ROLE_ARN", value = aws_iam_role.builder_execution[0].arn },
        { name = "PREVIEW_BUILD_JOB_PUBLIC_KEY_PEM", value = replace(var.preview_build_job_public_key_pem, "\\n", "\n") },
      ]
      secrets = [
        {
          name      = "PREVIEW_BUILD_RECEIPT_PRIVATE_KEY_PEM"
          valueFrom = aws_secretsmanager_secret.preview_attestor_signing_key[0].arn
        },
      ]
      mountPoints  = []
      portMappings = []
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.preview[0].name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "attestor"
        }
      }
    },
  ])

  tags = merge(local.common_tags, {
    Name    = "${var.name_prefix}-vite-attestor"
    Purpose = "One-off signed Preview build attestation"
  })

  lifecycle {
    precondition {
      condition = (
        startswith(
          local.configured_builder_task_definition_arn,
          local.builder_task_definition_arn_prefix,
        ) &&
        can(regex(":[0-9]+$", local.configured_builder_task_definition_arn))
      )
      error_message = "The configured Builder task definition must be a version in this account, region, and fixed Builder family."
    }
  }

  depends_on = [
    aws_iam_role_policy.attestor_execution_inputs,
    aws_iam_role_policy.attestor_task,
    aws_iam_role_policy_attachment.attestor_execution,
  ]
}

resource "aws_iam_role" "gateway_execution" {
  count = local.enabled ? 1 : 0
  name  = "${var.name_prefix}-gateway-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = merge(local.common_tags, { Name = "${var.name_prefix}-gateway-execution" })
}

resource "aws_iam_role_policy_attachment" "gateway_execution" {
  count      = local.enabled ? 1 : 0
  role       = aws_iam_role.gateway_execution[0].name
  policy_arn = "arn:${data.aws_partition.current[0].partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "runner_execution" {
  count = local.enabled ? 1 : 0
  name  = "${var.name_prefix}-runner-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = merge(local.common_tags, { Name = "${var.name_prefix}-runner-execution" })
}

resource "aws_iam_role" "builder_execution" {
  count = local.enabled ? 1 : 0
  name  = "${var.name_prefix}-builder-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = merge(local.common_tags, { Name = "${var.name_prefix}-builder-execution" })
}

resource "aws_iam_role_policy_attachment" "builder_execution" {
  count      = local.enabled ? 1 : 0
  role       = aws_iam_role.builder_execution[0].name
  policy_arn = "arn:${data.aws_partition.current[0].partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "builder_envelope" {
  count = local.enabled ? 1 : 0
  name  = "${var.name_prefix}-builder-envelope-read"
  role  = aws_iam_role.builder_execution[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadOnlyBuilderJobEnvelopes"
      Effect   = "Allow"
      Action   = ["s3:GetObject"]
      Resource = ["${aws_s3_bucket.preview_artifacts[0].arn}/builder-job-envelopes/*"]
    }]
  })
}

resource "aws_iam_role" "attestor_execution" {
  count = local.enabled ? 1 : 0
  name  = "${var.name_prefix}-attestor-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = merge(local.common_tags, { Name = "${var.name_prefix}-attestor-execution" })
}

resource "aws_iam_role_policy_attachment" "attestor_execution" {
  count      = local.enabled ? 1 : 0
  role       = aws_iam_role.attestor_execution[0].name
  policy_arn = "arn:${data.aws_partition.current[0].partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "attestor_execution_inputs" {
  count = local.enabled ? 1 : 0
  name  = "${var.name_prefix}-attestor-execution-inputs"
  role  = aws_iam_role.attestor_execution[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadOnlyAttestorCommandEnvelopes"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = ["${aws_s3_bucket.preview_artifacts[0].arn}/attestor-command-envelopes/*"]
      },
      {
        Sid      = "ReadOnlyReceiptSigningKey"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.preview_attestor_signing_key[0].arn]
      },
    ]
  })
}

resource "aws_iam_role" "attestor_task" {
  count = local.enabled ? 1 : 0
  name  = "${var.name_prefix}-attestor-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = merge(local.common_tags, { Name = "${var.name_prefix}-attestor-task" })
}

resource "aws_iam_role_policy" "attestor_task" {
  count = local.enabled ? 1 : 0
  name  = "${var.name_prefix}-attestor-read-and-receipt"
  role  = aws_iam_role.attestor_task[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "DescribeOnlyBoundBuilderResources"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTaskDefinition"]
        Resource = [local.builder_task_definition_arn]
      },
      {
        Sid      = "InspectTasksInPreviewClusterOnly"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTasks"]
        Resource = ["*"]
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.preview[0].arn }
        }
      },
      {
        Sid      = "ReadOnlyBuilderOutput"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = ["${aws_s3_bucket.preview_artifacts[0].arn}/preview-build-outputs/*"]
      },
      {
        Sid      = "WriteOnlyAttestorReceipts"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = ["${aws_s3_bucket.preview_artifacts[0].arn}/preview-build-receipts/*"]
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "runner_execution" {
  count      = local.enabled ? 1 : 0
  role       = aws_iam_role.runner_execution[0].name
  policy_arn = "arn:${data.aws_partition.current[0].partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "gateway_control" {
  count = local.enabled ? 1 : 0
  name  = "${var.name_prefix}-gateway-control"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = merge(local.common_tags, { Name = "${var.name_prefix}-gateway-control" })
}

resource "aws_iam_role_policy" "gateway_control" {
  count = local.enabled ? 1 : 0
  name  = "${var.name_prefix}-preview-task-control"
  role  = aws_iam_role.gateway_control[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RunOnlyCandidatePreviewDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = [local.preview_task_definition_arn, aws_ecs_cluster.preview[0].arn]
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.preview[0].arn }
        }
      },
      {
        Sid      = "InspectCandidatePreviewDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTaskDefinition"]
        Resource = [local.preview_task_definition_arn]
      },
      {
        Sid      = "RunOnlyPinnedBuilderDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = [local.builder_task_definition_arn, aws_ecs_cluster.preview[0].arn]
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.preview[0].arn }
        }
      },
      {
        Sid      = "InspectPinnedBuilderDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTaskDefinition"]
        Resource = [local.builder_task_definition_arn]
      },
      {
        Sid      = "RunOnlyPinnedAttestorDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = [local.attestor_task_definition_arn, aws_ecs_cluster.preview[0].arn]
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.preview[0].arn }
        }
      },
      {
        Sid      = "InspectPinnedAttestorDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTaskDefinition"]
        Resource = [local.attestor_task_definition_arn]
      },
      {
        Sid      = "InspectAndStopTasksInPreviewCluster"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTasks", "ecs:ListTasks", "ecs:StopTask"]
        Resource = ["*"]
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.preview[0].arn }
        }
      },
      {
        Sid    = "PassOnlyPreviewTaskRoles"
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          aws_iam_role.runner_execution[0].arn,
          aws_iam_role.builder_execution[0].arn,
          aws_iam_role.attestor_execution[0].arn,
          aws_iam_role.attestor_task[0].arn,
        ]
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
      {
        Sid      = "FencePreviewCommandsOnly"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = [aws_dynamodb_table.preview_command_fence[0].arn]
      },
      {
        Sid      = "ClaimOrResumeSameBuilderJobs"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem"]
        Resource = [aws_dynamodb_table.preview_builder_job_fence[0].arn]
      },
      {
        Sid      = "ClaimOrResumeSameAttestorJobs"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem"]
        Resource = [aws_dynamodb_table.preview_attestor_job_fence[0].arn]
      },
      {
        Sid      = "StoreBoundBuildInputs"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = ["${aws_s3_bucket.preview_artifacts[0].arn}/build-inputs/*"]
      },
      {
        Sid      = "TransferBoundBuildOutputs"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = ["${aws_s3_bucket.preview_artifacts[0].arn}/preview-build-outputs/*"]
      },
      {
        Sid      = "WriteAndConfirmBuilderJobEnvelopes"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = ["${aws_s3_bucket.preview_artifacts[0].arn}/builder-job-envelopes/*"]
      },
      {
        Sid      = "WriteAndConfirmAttestorCommandEnvelopes"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = ["${aws_s3_bucket.preview_artifacts[0].arn}/attestor-command-envelopes/*"]
      },
      {
        Sid      = "ReadAttestorReceipts"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = ["${aws_s3_bucket.preview_artifacts[0].arn}/preview-build-receipts/*"]
      },
      {
        Sid      = "ListAttestorReceiptPrefix"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [aws_s3_bucket.preview_artifacts[0].arn]
        Condition = {
          StringLike = {
            "s3:prefix" = ["preview-build-receipts/*"]
          }
        }
      },
    ]
  })
}
