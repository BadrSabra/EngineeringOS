import { describe, expect, it } from 'vitest';
import type { AiExecutionProjection } from '@workspace/api-client-react';
import { getResultDetails } from './result-details';

const projection = (status: 'passed' | 'failed' | 'running' | 'unavailable', proofRequired = true, verdict = 'PROVEN') =>
  ({ verification: { status, proofRequired, evidenceVerdict: verdict },
    approval: { required: false, status: 'NOT_REQUIRED', proposalId: null } } as AiExecutionProjection);

describe('result detail display boundaries', () => {
  it('does not promote a PROVEN checkpoint projection into freshly accepted completion', () => {
    const result = getResultDetails({ kind: 'execution', executionStatus: 'completed', projection: projection('passed') });
    expect(result.title).toBe('انتهى العمل بحسب السجل');
    expect(result.verification).toContain('لا يُستنتج من هذا الإسقاط');
    expect(result.explanation).toContain('لا تأكيد حديث');
  });
  it('keeps incomplete required evidence visible despite completed/passed records', () => {
    expect(getResultDetails({ kind: 'execution', executionStatus: 'completed',
      projection: projection('passed', true, 'PARTIAL') }).title).toBe('لم أتمكن من تأكيد النتيجة');
  });
  it('does not infer proof requirements or an absence of testing from missing data', () => {
    const result = getResultDetails({ kind: 'execution', executionStatus: 'completed' });
    expect(result.verification).toContain('لا توجد تفاصيل');
    expect(result.checks).toContain('لا يعني أن العمل لم يُختبر');
    expect(result.scope).not.toContain('غير مطلوب');
  });
  it('keeps explicit not-required requests separate from engineering verification', () => {
    expect(getResultDetails({ kind: 'execution', executionStatus: 'completed',
      projection: projection('passed', false) }).scope).toContain('لا يمنحه علامة تحقق هندسي');
  });
  it('prioritizes cancellation over stale passed verification and approval', () => {
    const p = projection('passed');
    p.approval = { required: true, status: 'PENDING', proposalId: 'p' };
    expect(getResultDetails({ kind: 'execution', executionStatus: 'cancelled', projection: p }).title).toBe('توقف العمل بالإلغاء');
  });
  it('keeps a real server PENDING approval visible even when the execution is completed', () => {
    const p = projection('passed');
    p.approval = { required: true, status: 'PENDING', proposalId: 'p' };
    expect(getResultDetails({ kind: 'execution', executionStatus: 'completed', projection: p }).title).toBe('يحتاج مراجعتك');
  });
  it('does not use plan membership or a recorded Goal completion as Goal proof', () => {
    const result = getResultDetails({ kind: 'goal', status: 'completed', planBinding: 'active_revision', inCurrentPlan: true });
    expect(result.title).toBe('انتهى العمل بحسب السجل');
    expect(result.scope).toContain('لا يثبت إنجازه');
    expect(result.basis).toContain('ليست إثباتًا حديثًا');
  });
  it('retains revision mismatch and legacy ambiguity instead of inventing current-plan success', () => {
    expect(getResultDetails({ kind: 'goal', status: 'completed', planBinding: 'revision_mismatch' }).scope).toContain('غير مطابق');
    expect(getResultDetails({ kind: 'goal', status: 'completed', planBinding: 'legacy_unversioned' }).scope).toContain('لا تُفترض');
  });
  it('keeps ongoing work distinct from final verification and exposes only a valid recorded attempt', () => {
    const result = getResultDetails({ kind: 'execution', executionStatus: 'running', projection: projection('running'), attempt: 2 });
    expect(result.title).toBe('العمل لم ينتهِ بعد');
    expect(result.explanation).toContain('100٪');
    expect(result.attempt).toBe(2);
    expect(getResultDetails({ kind: 'goal', status: 'running', attempt: -1 }).attempt).toBeNull();
  });
});
