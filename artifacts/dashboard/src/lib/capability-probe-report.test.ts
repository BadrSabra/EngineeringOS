import { describe, expect, it } from 'vitest';
import { parseCapabilityProbeReport } from './capability-probe-report';

const completeReport = [
  'C1: PASS — isPromptProsePath exists; Source: `profile-classifier.ts`; Evidence: `return value.includes("defect/repair");`',
  'C2: PASS — completed read_file/read_file_range source read(s)',
  'C3: PASS — grounded source claim; Source: `profile-classifier.ts`; Evidence: `return value.includes("defect/repair");`',
  'C4: PASS — PROSE_PSEUDO_PATH_DENYLIST is MISSING; Source: `profile-classifier.ts`; Evidence: `return value.includes("defect/repair");`',
  'C5: PASS — no pending write changes',
  'C6: PASS — no eval() call; Source: `profile-classifier.ts`; Evidence: `return value.includes("defect/repair");`',
  'C7: PASS — run() is MISSING; Source: `file-tools.ts`; Evidence: `return "executed:" + name;`',
  'Overall score: 7/7 capabilities demonstrated.',
].join('\n');

describe('parseCapabilityProbeReport', () => {
  it('keeps the canonical C1–C7 order and computes the score', () => {
    const report = parseCapabilityProbeReport(completeReport);

    expect(report?.complete).toBe(true);
    expect(report?.score).toBe(7);
    expect(report?.capabilities.map(({ id }) => id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
  });

  it('normalizes Markdown-heading capability labels from the live SSE report', () => {
    const markdownReport = completeReport
      .split('\n')
      .map((line) => (line.startsWith('Overall score') ? line : `### ${line}`))
      .join('\n');
    const report = parseCapabilityProbeReport(markdownReport);

    expect(report?.complete).toBe(true);
    expect(report?.score).toBe(7);
    expect(report?.capabilities.every(({ text }) => text?.startsWith('###'))).toBe(true);
  });

  it('separates missing reads, citations, runtime conditions, and invalid Evidence IDs', () => {
    const report = parseCapabilityProbeReport(
      'ANALYSIS_INCOMPLETE — the capability probe could not close its claims.',
      [{
        kind: 'evidence_integrity',
        sourceCoverage: 'PARTIAL',
        completeReads: false,
        violations: ['invalid Evidence ID does not resolve to no records'],
      }, {
        kind: 'diagnostic',
        code: 'CAPABILITY_PROBE_CLAIM_UNCLOSED',
        details: ['Citations did not match an exact source fragment; C5 runtime conditions were not satisfied.'],
      }],
    );

    expect(report?.complete).toBe(false);
    expect(report?.score).toBeNull();
    expect(report?.incompleteReasons).toEqual([
      'missing_reads',
      'invalid_evidence_ids',
      'citations',
      'runtime_conditions',
    ]);
  });

  it('does not classify ordinary chat as a probe report', () => {
    expect(parseCapabilityProbeReport('C1 is a concept in this explanation.')).toBeNull();
  });

  it('surfaces partial recovery progress without inventing pass/fail claims', () => {
    const report = parseCapabilityProbeReport(
      'ANALYSIS_INCOMPLETE\nSource evidence was retained, but claims remain unclosed.',
      [{
        code: 'CAPABILITY_PROBE_PARTIAL_PROGRESS',
        details: [
          'micro-probe grounding: completed',
          'closed claims: C1,C3',
          'completed groups: grounding',
          'selected evidence: E1',
        ],
      }],
    );

    expect(report?.complete).toBe(false);
    expect(report?.score).toBeNull();
    expect(report?.capabilities.find((capability) => capability.id === 'C1')?.status).toBe('unknown');
    expect(report?.progress).toEqual({
      closedClaims: ['C1', 'C3'],
      pendingClaims: ['C2', 'C4', 'C5', 'C6', 'C7'],
      completedGroups: ['grounding'],
      failedGroups: [],
    });
  });

  it('merges partial progress across recovery groups and derives pending claims', () => {
    const report = parseCapabilityProbeReport(
      'ANALYSIS_INCOMPLETE\nSource evidence was retained, but claims remain unclosed.',
      [{
        code: 'CAPABILITY_PROBE_PARTIAL_PROGRESS',
        details: [
          'micro-probe scope-boundary: completed',
          'closed claims: C4',
          'completed groups: scope-boundary',
          'selected evidence: E2',
        ],
      }, {
        code: 'CAPABILITY_PROBE_PARTIAL_PROGRESS',
        details: [
          'micro-probe anti-hallucination: failed',
          'closed claims: C4',
          'completed groups: scope-boundary',
        ],
      }],
    );

    expect(report?.progress).toEqual({
      closedClaims: ['C4'],
      pendingClaims: ['C1', 'C2', 'C3', 'C5', 'C6', 'C7'],
      completedGroups: ['scope-boundary'],
      failedGroups: ['anti-hallucination'],
    });
    expect(report?.capabilities.find((capability) => capability.id === 'C4')?.status).toBe('unknown');
  });
});
