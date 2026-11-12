variable "enable_foundation_resources" {
  description = "Explicit opt-in for creating the AWS network and empty preview foundation."
  type        = bool
  default     = false
}

variable "aws_region" {
  description = "AWS region. Required for planning enabled resources."
  type        = string

  validation {
    condition     = trimspace(var.aws_region) != ""
    error_message = "Set aws_region before running Terraform."
  }
}

variable "name_prefix" {
  description = "Short lowercase prefix used for Preview resources."
  type        = string
  default     = "engineeringos-preview"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,25}$", var.name_prefix))
    error_message = "name_prefix must be 3-26 lowercase letters, digits, or hyphens and start with a letter."
  }
}

variable "preview_builder_task_definition_arn" {
  description = "Optional exact external Builder task-definition ARN; when empty, Terraform registers its fixed definition after the image digest and verification key are supplied."
  type        = string
  default     = ""

  validation {
    condition = (
      var.preview_builder_task_definition_arn == "" ||
      can(regex("^arn:(aws|aws-us-gov|aws-cn):ecs:[a-z0-9-]+:[0-9]{12}:task-definition/${var.name_prefix}-vite-builder:[0-9]+$", var.preview_builder_task_definition_arn))
    )
    error_message = "preview_builder_task_definition_arn must identify one versioned Builder task definition."
  }
}

variable "preview_builder_image_digest" {
  description = "Exact SHA-256 digest of the approved Builder image."
  type        = string
  default     = ""

  validation {
    condition     = var.preview_builder_image_digest == "" || can(regex("^sha256:[a-f0-9]{64}$", var.preview_builder_image_digest))
    error_message = "preview_builder_image_digest must be empty or a sha256 digest."
  }
}

variable "preview_attestor_image_digest" {
  description = "Exact SHA-256 digest of the approved Attestor image; empty disables Attestor task-definition registration."
  type        = string
  default     = ""

  validation {
    condition     = var.preview_attestor_image_digest == "" || can(regex("^sha256:[a-f0-9]{64}$", var.preview_attestor_image_digest))
    error_message = "preview_attestor_image_digest must be empty or a sha256 digest."
  }
}

variable "preview_build_job_public_key_pem" {
  description = "Public Ed25519 key used by Builder and Attestor to verify API-signed build jobs; never a private key."
  type        = string
  default     = ""

  validation {
    condition = (
      var.preview_build_job_public_key_pem == "" ||
      (
        strcontains(var.preview_build_job_public_key_pem, "-----BEGIN PUBLIC KEY-----") &&
        strcontains(var.preview_build_job_public_key_pem, "-----END PUBLIC KEY-----")
      )
    )
    error_message = "preview_build_job_public_key_pem must be empty or an Ed25519 public-key PEM."
  }
}

variable "vpc_cidr" {
  description = "Private IPv4 range reserved for the Preview VPC."
  type        = string
  default     = "10.86.0.0/16"

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr))
    error_message = "vpc_cidr must be a valid IPv4 CIDR."
  }
}

variable "public_subnet_cidrs" {
  description = "Two public subnet CIDRs keyed by Availability Zone name; used only by a future TLS gateway."
  type        = map(string)
  default     = {}

  validation {
    condition = length(var.public_subnet_cidrs) == 0 || (
      length(var.public_subnet_cidrs) == 2 &&
      alltrue([for cidr in values(var.public_subnet_cidrs) : can(cidrnetmask(cidr))])
    )
    error_message = "Provide no public subnets while disabled, or exactly two valid IPv4 CIDRs."
  }
}

variable "private_subnet_cidrs" {
  description = "Two private subnet CIDRs keyed by the same Availability Zone names."
  type        = map(string)
  default     = {}

  validation {
    condition = length(var.private_subnet_cidrs) == 0 || (
      length(var.private_subnet_cidrs) == 2 &&
      alltrue([for cidr in values(var.private_subnet_cidrs) : can(cidrnetmask(cidr))])
    )
    error_message = "Provide no private subnets while disabled, or exactly two valid IPv4 CIDRs."
  }
}

variable "ecr_layer_bucket_arn" {
  description = "Regional AWS-managed ECR layer bucket ARN allowed through the private S3 endpoint."
  type        = string
  default     = ""

  validation {
    condition = (
      var.ecr_layer_bucket_arn == "" ||
      can(regex("^arn:[^:]+:s3:::[^/]+$", var.ecr_layer_bucket_arn))
    )
    error_message = "ecr_layer_bucket_arn must be a bucket ARN without an object path."
  }
}

variable "preview_port" {
  description = "Fixed port a future Gateway may use to reach the static Vite/React preview."
  type        = number
  default     = 8080

  validation {
    condition     = var.preview_port >= 1024 && var.preview_port <= 65535
    error_message = "preview_port must be an unprivileged TCP port."
  }
}

variable "log_retention_days" {
  description = "Retention for future bounded preview service logs."
  type        = number
  default     = 7

  validation {
    condition     = contains([1, 3, 5, 7, 14], var.log_retention_days)
    error_message = "log_retention_days must be one of 1, 3, 5, 7, or 14."
  }
}

variable "tags" {
  description = "Non-sensitive AWS resource tags."
  type        = map(string)
  default     = {}
}
