import { describe, expect, it } from 'vitest';
import {
  activityEventsFromToolTrace,
  formatElapsed,
  liveStageDisplayLabel,
  liveToolLabel,
  PLAN_STAGE_LABELS,
} from './live-activity';
import type { ToolTraceEntry } from './trace-parsing';

describe('live activity Arabic presentation', () => {
  it('localizes known tool and planning labels without translating tool identifiers or paths', () => {
    expect(liveToolLabel({ tool: 'read_file', source: 'src/main.ts', done: true })).toBe(
      'قراءة المصدر · src/main.ts',
    );
    expect(liveToolLabel({ tool: 'git_status', done: true })).toBe('فحص حالة المستودع');
    expect(liveToolLabel({ tool: 'custom_executor', source: 'src/task.ts', done: true })).toBe(
      'custom_executor · src/task.ts',
    );
    expect(PLAN_STAGE_LABELS.understand).toBe('الفهم');
  });

  it('localizes recognized lifecycle stages while preserving unknown upstream stages verbatim', () => {
    expect(liveStageDisplayLabel('Building context…')).toBe('جارٍ تجهيز سياق المشروع…');
    expect(liveStageDisplayLabel('Validation passed (2/3)')).toBe('اجتاز التحقق (2/3)');
    expect(liveStageDisplayLabel('Execution stopped: repeated read_file')).toBe(
      'توقف التنفيذ بسبب تكرار الأداة: read_file',
    );
    expect(liveStageDisplayLabel('CUSTOM_STAGE: waiting for evidence')).toBe(
      'CUSTOM_STAGE: waiting for evidence',
    );
    expect(liveStageDisplayLabel(null)).toBe('جارٍ بدء التحليل');
    expect(liveStageDisplayLabel('Execution saved — ready to resume')).toBe('تم حفظ التنفيذ؛ وهو جاهز للاستئناف');
    expect(liveStageDisplayLabel('Project scan queued')).toBe('أُضيف فحص المشروع إلى قائمة الانتظار');
  });

  it('projects activity trace labels in Arabic while retaining diagnostic codes and source paths', () => {
    const events = activityEventsFromToolTrace([
      {
        kind: 'plan_activity',
        stage: 'understand',
        status: 'done',
        stepTitle: 'Inspect source',
        approvalRequired: true,
        files: ['src/main.ts'],
      },
      {
        kind: 'tool_call',
        tool: 'read_file',
        toolCallId: 'read-1',
        args: { path: 'src/main.ts' },
      },
      {
        kind: 'tool_result',
        tool: 'read_file',
        toolCallId: 'read-1',
        source: 'src/main.ts',
        cached: true,
      },
      {
        kind: 'diagnostic',
        code: 'OPENROUTER_MODEL_NOT_FOUND',
      },
    ] as unknown as ToolTraceEntry[]);

    expect(events[0]).toMatchObject({
      kind: 'plan',
      label: 'الفهم · Inspect source',
      detail: 'الموافقة مطلوبة قبل تغيير الملفات: src/main.ts',
    });
    expect(events[1]).toMatchObject({
      kind: 'tool',
      label: 'قراءة المصدر · src/main.ts',
      status: 'done',
      detail: 'مخزّن مؤقتًا · src/main.ts',
    });
    expect(events[2]).toMatchObject({
      kind: 'diagnostic',
      label: 'تشخيص التنفيذ',
      detail: 'OPENROUTER_MODEL_NOT_FOUND',
    });
  });

  it('formats elapsed time using Arabic units', () => {
    expect(formatElapsed(42)).toBe('42 ث');
    expect(formatElapsed(125)).toBe('2 د 05 ث');
  });
});
