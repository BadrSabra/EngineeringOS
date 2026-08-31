import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CAPABILITY_CONTRACT_VERSION,
  DEFAULT_CAPABILITY_POLICY,
  type CapabilityAdapter,
  validateCapabilityInvocationScope,
  toPublicRecipeReceipt,
  evaluateRecipeEvidencePredicate,
} from '../index.js';

function scopedCapability(): CapabilityAdapter {
  return {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    id: 'validation.scoped',
    supportedRecipeVersions: [1],
    policy: DEFAULT_CAPABILITY_POLICY,
    catalog: {
      purpose: 'Scoped validation fixture',
      inputShape: { type: 'object', fields: [{ type: 'string', name: 'path', required: true, description: 'target' }] },
      defaultScope: 'paths',
      supportedScopes: ['paths'],
      estimatedCost: 'low',
      mutatesProject: false,
      keywords: ['validation'],
      allowedPhases: ['validation'],
      projectIds: [],
      requiresAuthorization: false,
      expectedEvidence: ['validation_passed'],
    },
    inputSchema: z.object({ path: z.string() }).strict(),
    outputSchema: z.object({ ok: z.boolean() }).strict(),
    execute: () => ({ ok: true }),
  };
}

describe('recipe security boundaries', () => {
  it('rejects out-of-scope and sensitive targets before adapter I/O', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'recipe-security-'));
    await writeFile(path.join(root, 'safe.ts'), 'ok');
    const capability = scopedCapability();
    const context = { rootPath: root, operation: 'recipe', allowedFiles: ['safe.ts'] };
    await expect(validateCapabilityInvocationScope(capability, { path: 'other.ts' }, context))
      .resolves.toMatchObject({ code: 'CAPABILITY_SCOPE_VIOLATION' });
    await expect(validateCapabilityInvocationScope(capability, { path: '.env' }, context))
      .resolves.toMatchObject({ code: 'CAPABILITY_SCOPE_VIOLATION' });
  });

  it('rejects symlink targets that escape the project root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'recipe-root-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'recipe-outside-'));
    await writeFile(path.join(outside, 'secret.ts'), 'secret');
    await symlink(outside, path.join(root, 'linked'));
    await expect(validateCapabilityInvocationScope(
      scopedCapability(),
      { path: 'linked/secret.ts' },
      { rootPath: root, operation: 'recipe', allowedFiles: ['linked'] },
    )).resolves.toMatchObject({ code: 'CAPABILITY_SCOPE_VIOLATION' });
  });

  it('preserves typed outcome predicates fail closed', () => {
    expect(evaluateRecipeEvidencePredicate(
      { kind: 'node_status', nodeId: 'node-1', status: 'passed' },
      { 'node-1': { status: 'failed' } },
    )).toBe(false);
  });

  it('projects receipts without provider text or internal paths', () => {
    const publicReceipt = toPublicRecipeReceipt({
      contractVersion: 1,
      executionId: 'execution-1',
      operationId: 'operation-1',
      recipeId: 'candidate.verify',
      recipeVersion: 1,
      status: 'completed',
      completedNodeIds: ['node-1'],
      nodes: [{
        nodeId: 'node-1',
        status: 'passed',
        attempts: 1,
        elapsedMs: 4,
        evidenceId: 'evidence-1',
        excerpt: 'validated token=hidden at /home/runner/workspace/private',
      }],
      evidenceRefs: ['evidence-1'],
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    expect(publicReceipt).not.toBeNull();
    expect(publicReceipt?.nodes[0]?.excerpt).toContain('token=[redacted]');
    expect(publicReceipt?.nodes[0]?.excerpt).not.toContain('/home/runner/workspace');
    expect(publicReceipt).not.toHaveProperty('providerDiagnostics');
  });
});