import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const infraRoot = resolve(root, "infra/aws-preview");

const [main, variables, versions] = await Promise.all([
  readFile(resolve(infraRoot, "main.tf"), "utf8"),
  readFile(resolve(infraRoot, "variables.tf"), "utf8"),
  readFile(resolve(infraRoot, "versions.tf"), "utf8"),
]);

function resourceBlock(source, type, name) {
  const pattern = new RegExp(
    `resource\\s+"${type}"\\s+"${name}"\\s*\\{([\\s\\S]*?)\\n\\}`,
    "u",
  );
  const match = source.match(pattern);
  assert.ok(match, `Expected resource ${type}.${name}`);
  return match[1];
}

test("AWS foundation stays opt-in and has no remote Terraform backend", () => {
  assert.match(
    variables,
    /variable\s+"enable_foundation_resources"\s*\{[\s\S]*?default\s*=\s*false/u,
  );
  assert.doesNotMatch(`${main}\n${versions}`, /backend\s+"[^"]+"\s*\{/u);
});

test("private preview ingress is only from the Gateway on its fixed port", () => {
  const ingress = resourceBlock(
    main,
    "aws_vpc_security_group_ingress_rule",
    "runner_gateway",
  );
  assert.match(
    ingress,
    /referenced_security_group_id\s*=\s*aws_security_group\.gateway\[0\]\.id/u,
  );
  assert.match(ingress, /from_port\s*=\s*var\.preview_port/u);
  assert.match(ingress, /to_port\s*=\s*var\.preview_port/u);
  assert.doesNotMatch(ingress, /cidr_blocks|cidr_ipv4|cidr_ipv6/u);

  const gateway = resourceBlock(main, "aws_security_group", "gateway");
  assert.match(gateway, /ingress\s*=\s*\[\]/u);
});

test("private foundation has no NAT or default Internet route", () => {
  assert.doesNotMatch(main, /resource\s+"aws_nat_gateway"\s+"/u);
  assert.match(main, /map_public_ip_on_launch\s*=\s*false/u);
  const publicRoute = resourceBlock(main, "aws_route", "public_internet");
  assert.match(publicRoute, /aws_route_table\.public/u);
  assert.equal(main.split('resource "aws_route"').length - 1, 1);
});

test("Gateway and Attestor use separate private ECS control-plane rules", () => {
  const endpoint = resourceBlock(main, "aws_vpc_endpoint", "interface");
  assert.match(endpoint, /each\.value == "ecs"/u);
  assert.match(endpoint, /aws_security_group\.gateway_ecs_endpoint\[0\]\.id/u);

  const ingress = resourceBlock(
    main,
    "aws_vpc_security_group_ingress_rule",
    "gateway_ecs_endpoint_https",
  );
  assert.match(
    ingress,
    /referenced_security_group_id\s*=\s*aws_security_group\.gateway\[0\]\.id/u,
  );
  assert.match(ingress, /from_port\s*=\s*443/u);
  assert.match(ingress, /to_port\s*=\s*443/u);

  const attestorIngress = resourceBlock(
    main,
    "aws_vpc_security_group_ingress_rule",
    "attestor_ecs_endpoint_https",
  );
  assert.match(
    attestorIngress,
    /referenced_security_group_id\s*=\s*aws_security_group\.attestor\[0\]\.id/u,
  );
  assert.match(attestorIngress, /from_port\s*=\s*443/u);
  assert.match(attestorIngress, /to_port\s*=\s*443/u);
});

test("foundation cannot run Candidate code or delete active image history", () => {
  assert.doesNotMatch(
    main,
    /resource\s+"aws_(?:ecs_service|lb|ecr_lifecycle_policy)"\s+"/u,
  );
  assert.equal(
    [...main.matchAll(/resource\s+"aws_ecs_task_definition"\s+"/gu)].length,
    2,
  );
  const builderTaskDefinition = resourceBlock(
    main,
    "aws_ecs_task_definition",
    "builder",
  );
  assert.match(
    builderTaskDefinition,
    /count\s*=\s*local\.builder_task_definition_enabled/u,
  );
  assert.match(
    builderTaskDefinition,
    /aws_ecr_repository\.vite_builder\[0\]\.repository_url\}@\$\{var\.preview_builder_image_digest\}/u,
  );
  assert.match(builderTaskDefinition, /cpu_architecture\s*=\s*"X86_64"/u);
  assert.match(builderTaskDefinition, /name\s*=\s*"builder-tmp"/u);
  assert.match(builderTaskDefinition, /containerPath\s*=\s*"\/tmp"/u);
  assert.match(builderTaskDefinition, /readOnly\s*=\s*false/u);
  assert.doesNotMatch(builderTaskDefinition, /task_role_arn/u);
  const attestorTaskDefinition = resourceBlock(
    main,
    "aws_ecs_task_definition",
    "attestor",
  );
  assert.match(
    attestorTaskDefinition,
    /count\s*=\s*local\.attestor_task_definition_enabled/u,
  );
  assert.match(
    attestorTaskDefinition,
    /aws_ecr_repository\.vite_attestor\[0\]\.repository_url\}@\$\{var\.preview_attestor_image_digest\}/u,
  );
  assert.match(main, /image_tag_mutability\s*=\s*"IMMUTABLE"/u);
  assert.match(main, /force_delete\s*=\s*false/u);
  assert.match(main, /resource\s+"aws_iam_role"\s+"gateway_control"/u);
  assert.match(main, /resource\s+"aws_iam_role"\s+"runner_execution"/u);
  assert.match(main, /resource\s+"aws_iam_role"\s+"builder_execution"/u);
  assert.match(
    main,
    /resource\s+"aws_iam_role_policy_attachment"\s+"builder_execution"/u,
  );
  assert.match(main, /resource\s+"aws_iam_role_policy"\s+"gateway_control"/u);
  assert.match(main, /iam:PassRole/u);
  assert.match(main, /resource\s+"aws_vpc_endpoint"\s+"s3"/u);
});

test("S3 access is restricted to ECR layers and scoped Preview artifacts", () => {
  const endpoint = resourceBlock(main, "aws_vpc_endpoint", "s3");
  assert.match(endpoint, /ecr_layer_bucket_arn/u);
  assert.match(endpoint, /Action\s*=\s*\["s3:GetObject"\]/u);
  assert.match(endpoint, /AllowPreviewBuildInputObjects/u);
  assert.match(endpoint, /AllowPreviewBuildOutputObjects/u);
  assert.match(endpoint, /AllowBuilderJobEnvelopeObjects/u);
  assert.match(endpoint, /AllowAttestorCommandEnvelopeReads/u);
  assert.match(endpoint, /AllowAttestorReceiptObjects/u);
  assert.match(endpoint, /ListAttestorReceiptPrefix/u);
  assert.match(endpoint, /"s3:GetObject",\s*"s3:PutObject"/u);
  assert.match(endpoint, /aws_s3_bucket\.preview_artifacts\[0\]\.arn/u);
  assert.doesNotMatch(endpoint, /s3:\*/u);

  assert.match(
    main,
    /resource\s+"aws_s3_bucket"\s+"preview_artifacts"\s*\{\s*count\s*=\s*local\.enabled\s*\?\s*1\s*:\s*0/u,
  );
  assert.match(main, /block_public_acls\s*=\s*true/u);
  assert.match(main, /restrict_public_buckets\s*=\s*true/u);
  assert.match(
    main,
    /resource\s+"aws_s3_bucket_policy"\s+"preview_artifacts"\s*\{\s*count\s*=\s*local\.enabled\s*\?\s*1\s*:\s*0/u,
  );
  assert.match(main, /"aws:SecureTransport"\s*=\s*"false"/u);
  assert.match(main, /object_ownership\s*=\s*"BucketOwnerEnforced"/u);
  assert.match(main, /sse_algorithm\s*=\s*"AES256"/u);
  assert.match(main, /prefix\s*=\s*"build-inputs\/"/u);
  assert.match(main, /prefix\s*=\s*"preview-build-outputs\/"/u);
  assert.match(main, /prefix\s*=\s*"builder-job-envelopes\/"/u);
  assert.match(main, /prefix\s*=\s*"attestor-command-envelopes\/"/u);
  assert.match(main, /prefix\s*=\s*"preview-build-receipts\/"/u);
  assert.match(main, /expiration\s*\{\s*days\s*=\s*1\s*\}/u);

  const gatewayPolicy = main.slice(
    main.indexOf('resource "aws_iam_role_policy" "gateway_control"'),
  );
  assert.match(gatewayPolicy, /"s3:PutObject",\s*"s3:GetObject"/u);
  assert.match(
    gatewayPolicy,
    /aws_s3_bucket\.preview_artifacts\[0\]\.arn\}\/build-inputs\/\*/u,
  );
  assert.match(gatewayPolicy, /TransferBoundBuildOutputs/u);
  assert.match(gatewayPolicy, /WriteAndConfirmBuilderJobEnvelopes/u);
  assert.match(
    gatewayPolicy,
    /aws_s3_bucket\.preview_artifacts\[0\]\.arn\}\/preview-build-outputs\/\*/u,
  );
  assert.match(
    gatewayPolicy,
    /aws_s3_bucket\.preview_artifacts\[0\]\.arn\}\/builder-job-envelopes\/\*/u,
  );
  const builderExecutionPolicy = resourceBlock(
    main,
    "aws_iam_role_policy",
    "builder_envelope",
  );
  assert.match(builderExecutionPolicy, /s3:GetObject/u);
  assert.doesNotMatch(builderExecutionPolicy, /s3:PutObject/u);
  assert.match(
    builderExecutionPolicy,
    /aws_s3_bucket\.preview_artifacts\[0\]\.arn\}\/builder-job-envelopes\/\*/u,
  );
});

test("provisions private ECS, image-pull, and log endpoints", () => {
  const interfaceServices = main.match(
    /interface_services\s*=\s*toset\(\[([\s\S]*?)\]\)/u,
  );
  assert.ok(interfaceServices);
  assert.match(interfaceServices[1], /"ecr\.api"/u);
  assert.match(interfaceServices[1], /"ecr\.dkr"/u);
  assert.match(interfaceServices[1], /"logs"/u);
  assert.match(interfaceServices[1], /"ecs"/u);
  assert.match(interfaceServices[1], /"secretsmanager"/u);
});

test("Attestor signing identity and permissions are isolated", () => {
  const attestorGroup = resourceBlock(main, "aws_security_group", "attestor");
  assert.match(attestorGroup, /ingress\s*=\s*\[\]/u);
  assert.match(attestorGroup, /egress\s*=\s*\[\]/u);
  const attestorEcsEgress = resourceBlock(
    main,
    "aws_vpc_security_group_egress_rule",
    "attestor_ecs_endpoint",
  );
  assert.match(
    attestorEcsEgress,
    /referenced_security_group_id\s*=\s*aws_security_group\.gateway_ecs_endpoint\[0\]\.id/u,
  );
  const serviceEgress = resourceBlock(
    main,
    "aws_vpc_security_group_egress_rule",
    "service_endpoints",
  );
  const s3Egress = resourceBlock(
    main,
    "aws_vpc_security_group_egress_rule",
    "service_s3",
  );
  assert.match(serviceEgress, /attestor\s*=\s*aws_security_group\.attestor/u);
  assert.match(s3Egress, /attestor\s*=\s*aws_security_group\.attestor/u);

  assert.match(
    main,
    /resource\s+"aws_secretsmanager_secret"\s+"preview_attestor_signing_key"/u,
  );
  const execution = resourceBlock(
    main,
    "aws_iam_role_policy",
    "attestor_execution_inputs",
  );
  assert.match(execution, /secretsmanager:GetSecretValue/u);
  assert.match(
    execution,
    /aws_secretsmanager_secret\.preview_attestor_signing_key\[0\]\.arn/u,
  );
  const task = resourceBlock(main, "aws_iam_role_policy", "attestor_task");
  assert.match(task, /ecs:DescribeTaskDefinition/u);
  assert.match(task, /ecs:DescribeTasks/u);
  assert.match(task, /preview-build-outputs\/\*/u);
  assert.match(task, /preview-build-receipts\/\*/u);
  assert.doesNotMatch(
    task,
    /secretsmanager|iam:PassRole|ecs:RunTask|s3:DeleteObject/u,
  );
  assert.match(main, /resource\s+"aws_ecr_repository"\s+"vite_attestor"/u);
  const taskDefinition = resourceBlock(
    main,
    "aws_ecs_task_definition",
    "attestor",
  );
  assert.match(
    taskDefinition,
    /count\s*=\s*local\.attestor_task_definition_enabled\s*\?\s*1\s*:\s*0/u,
  );
  assert.match(taskDefinition, /cpu\s*=\s*"256"/u);
  assert.match(taskDefinition, /memory\s*=\s*"512"/u);
  assert.match(taskDefinition, /preview_attestor_image_digest/u);
  assert.match(taskDefinition, /preview_build_job_public_key_pem/u);
  assert.match(
    taskDefinition,
    /PREVIEW_BUILD_RECEIPT_PRIVATE_KEY_PEM[\s\S]*?valueFrom\s*=\s*aws_secretsmanager_secret\.preview_attestor_signing_key/u,
  );
  assert.match(taskDefinition, /user\s*=\s*"10001:10001"/u);
  assert.match(taskDefinition, /readonlyRootFilesystem\s*=\s*true/u);
  assert.match(taskDefinition, /drop\s*=\s*\["ALL"\]/u);
  assert.match(taskDefinition, /mountPoints\s*=\s*\[\]/u);
  assert.match(taskDefinition, /portMappings\s*=\s*\[\]/u);
  assert.match(variables, /variable\s+"preview_attestor_image_digest"/u);
  assert.match(variables, /variable\s+"preview_builder_task_definition_arn"/u);
  assert.match(variables, /variable\s+"preview_build_job_public_key_pem"/u);
});

test("DynamoDB stores only private, TTL-cleaned execution fences", () => {
  const table = resourceBlock(
    main,
    "aws_dynamodb_table",
    "preview_command_fence",
  );
  assert.match(table, /count\s*=\s*local\.enabled\s*\?\s*1\s*:\s*0/u);
  assert.match(table, /billing_mode\s*=\s*"PAY_PER_REQUEST"/u);
  assert.match(table, /deletion_protection_enabled\s*=\s*true/u);
  assert.match(table, /attribute_name\s*=\s*"expires_at_epoch"/u);

  const buildJobTable = resourceBlock(
    main,
    "aws_dynamodb_table",
    "preview_builder_job_fence",
  );
  assert.match(buildJobTable, /hash_key\s*=\s*"job_id"/u);
  assert.match(buildJobTable, /deletion_protection_enabled\s*=\s*true/u);
  assert.match(buildJobTable, /attribute_name\s*=\s*"expires_at_epoch"/u);

  const attestorTable = resourceBlock(
    main,
    "aws_dynamodb_table",
    "preview_attestor_job_fence",
  );
  assert.match(attestorTable, /hash_key\s*=\s*"job_id"/u);
  assert.match(attestorTable, /deletion_protection_enabled\s*=\s*true/u);
  assert.match(attestorTable, /attribute_name\s*=\s*"expires_at_epoch"/u);

  const endpoint = resourceBlock(main, "aws_vpc_endpoint", "dynamodb");
  assert.match(endpoint, /vpc_endpoint_type\s*=\s*"Gateway"/u);
  assert.match(
    endpoint,
    /aws_dynamodb_table\.preview_command_fence\[0\]\.arn/u,
  );
  assert.match(
    endpoint,
    /aws_dynamodb_table\.preview_builder_job_fence\[0\]\.arn/u,
  );
  assert.match(
    endpoint,
    /aws_dynamodb_table\.preview_attestor_job_fence\[0\]\.arn/u,
  );
  assert.match(
    endpoint,
    /"dynamodb:GetItem",\s*"dynamodb:UpdateItem",\s*"dynamodb:PutItem"/u,
  );

  const egress = resourceBlock(
    main,
    "aws_vpc_security_group_egress_rule",
    "gateway_dynamodb",
  );
  assert.match(egress, /aws_security_group\.gateway\[0\]\.id/u);
  assert.match(egress, /data\.aws_prefix_list\.dynamodb\[0\]\.id/u);

  const gatewayPolicy = resourceBlock(
    main,
    "aws_iam_role_policy",
    "gateway_control",
  );
  assert.match(gatewayPolicy, /ecs:ListTasks/u);
  assert.match(gatewayPolicy, /dynamodb:GetItem/u);
  assert.match(gatewayPolicy, /dynamodb:UpdateItem/u);
  assert.match(
    gatewayPolicy,
    /aws_dynamodb_table\.preview_command_fence\[0\]\.arn/u,
  );
  assert.match(gatewayPolicy, /dynamodb:PutItem/u);
  assert.match(gatewayPolicy, /ClaimOrResumeSameBuilderJobs/u);
  assert.match(
    gatewayPolicy,
    /ClaimOrResumeSameBuilderJobs[\s\S]*?dynamodb:GetItem[\s\S]*?dynamodb:PutItem/u,
  );
  assert.match(
    gatewayPolicy,
    /aws_dynamodb_table\.preview_builder_job_fence\[0\]\.arn/u,
  );
  assert.match(gatewayPolicy, /ClaimOrResumeSameAttestorJobs/u);
  assert.match(
    gatewayPolicy,
    /ClaimOrResumeSameAttestorJobs[\s\S]*?dynamodb:GetItem[\s\S]*?dynamodb:PutItem/u,
  );
  assert.match(
    gatewayPolicy,
    /aws_dynamodb_table\.preview_attestor_job_fence\[0\]\.arn/u,
  );
});

test("Builder launches use their own no-ingress security group and fixed task family", () => {
  const builderGroup = resourceBlock(main, "aws_security_group", "builder");
  assert.match(builderGroup, /ingress\s*=\s*\[\]/u);
  assert.match(builderGroup, /egress\s*=\s*\[\]/u);
  const endpointIngress = resourceBlock(
    main,
    "aws_vpc_security_group_ingress_rule",
    "endpoint_https",
  );
  assert.match(
    endpointIngress,
    /builder\s*=\s*aws_security_group\.builder\[0\]\.id/u,
  );
  const builderEgress = main.matchAll(
    /resource\s+"aws_vpc_security_group_egress_rule"\s+"([^"]+)"\s*\{([\s\S]*?)\n\}/gu,
  );
  const builderRules = [...builderEgress]
    .map((match) => match[2])
    .filter((block) =>
      /builder\s*=\s*aws_security_group\.builder\[0\]\.id/u.test(block),
    );
  assert.ok(builderRules.length >= 2);
  const policy = resourceBlock(main, "aws_iam_role_policy", "gateway_control");
  assert.match(policy, /RunOnlyPinnedBuilderDefinitions/u);
  assert.match(policy, /InspectPinnedBuilderDefinitions/u);
  assert.match(policy, /local\.builder_task_definition_arn/u);
  assert.match(policy, /aws_iam_role\.builder_execution\[0\]\.arn/u);
});
