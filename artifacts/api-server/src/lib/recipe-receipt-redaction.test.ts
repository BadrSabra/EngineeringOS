import { describe, expect, it } from 'vitest';
import { toPublicRecipeReceipt } from '@workspace/ai-orchestrator';

describe('recipe receipt public projection', () => {
  it('keeps only the receipt contract and redacts sensitive excerpts', () => {
    const projected = toPublicRecipeReceipt({
      contractVersion: 1,
      executionId: 'exec-1',
      operationId: 'op-1',
      recipeId: 'validation.recover',
      recipeVersion: 1,
      status: 'blocked',
      completedNodeIds: [],
      nodes: [{
        nodeId: 'node-1',
        status: 'blocked',
        attempts: 1,
        elapsedMs: 10,
        evidenceId: null,
        excerpt: 'api_key=secret-value',
      }],
      evidenceRefs: [],
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
    expect(projected).not.toBeNull();
    expect(projected?.nodes[0]?.excerpt).toBe('api_key=[redacted]');
    expect(projected).not.toHaveProperty('rawProviderOutput');
    expect(JSON.stringify(projected)).not.toContain('secret-value');
  });
});