import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { EvidenceGraph } from '@workspace/api-client-react';
import { EvidenceGraphPanel } from './EvidenceGraphPanel';

afterEach(cleanup);

const emptyGraph = (): EvidenceGraph => ({
  version: 1, nodes: [], edges: [], reads: [], contradictionClaimIds: [],
});

describe('Arabic evidence graph presentation', () => {
  it('does not turn an empty graph or absence of contradictions into proof', () => {
    render(<EvidenceGraphPanel graph={emptyGraph()} />);
    const panel = screen.getByRole('region', { name: 'ترابط الأدلة' });
    expect(panel).toHaveAttribute('dir', 'rtl');
    expect(within(panel).getByText('لا توجد قراءات محفوظة.')).toBeInTheDocument();
    expect(within(panel).getByText('لا توجد عناصر في خريطة الأدلة.')).toBeInTheDocument();
    expect(within(panel).getByText('لا توجد أدلة مناقضة مسجلة')).toBeInTheDocument();
    expect(within(panel).getByText(/غياب أدلة مناقضة لا يثبت صحة كل ادعاء/)).toBeInTheDocument();
    expect(within(panel).queryByText('مثبت بحسب السجل')).not.toBeInTheDocument();
  });

  it.each([
    ['PROVEN', 'مثبت بحسب السجل'],
    ['CONTRADICTED', 'توجد أدلة مناقضة'],
    ['INCOMPLETE', 'الأدلة غير مكتملة'],
    ['NOT_PROVEN', 'غير مثبت'],
  ] as const)('projects recorded %s without changing its value or granting completion', (status, label) => {
    const graph: EvidenceGraph = {
      ...emptyGraph(),
      sourceRevision: 'revision/fixture-42',
      nodes: [{ id: 'claim:one', kind: 'CLAIM', label: 'Server-provided claim', status }],
      contradictionClaimIds: status === 'CONTRADICTED' ? ['claim:one'] : [],
    };
    render(<EvidenceGraphPanel graph={graph} />);
    expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Server-provided claim')).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('revision/fixture-42')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(/لا تمنح إذن تعديل ولا تثبت اكتمال التنفيذ/)).toBeInTheDocument();
    expect(graph.nodes[0].status).toBe(status);
    if (status === 'CONTRADICTED') {
      expect(screen.getByText('ادعاءات لها أدلة مناقضة: 1')).toBeInTheDocument();
    }
  });

  it('keeps read bounds, partial reads, relation direction, and compact/expanded limits', () => {
    const graph: EvidenceGraph = {
      ...emptyGraph(),
      nodes: Array.from({ length: 10 }, (_, index) => ({
        id: `file:${index}`, kind: 'FILE' as const, label: `source-${index}`,
      })),
      reads: Array.from({ length: 6 }, (_, index) => ({
        key: `read:${index}`, path: `src/fixture-${index}.ts`,
        startLine: 10, endLine: 24, truncated: index === 0, taskIndexes: [0, 1],
      })),
      edges: Array.from({ length: 10 }, (_, index) => ({
        id: `edge:${index}`, from: `file:${index}`, to: 'claim:result', relation: 'SUPPORTS' as const,
      })),
    };
    const before = JSON.stringify(graph);
    render(<EvidenceGraphPanel graph={graph} />);
    expect(screen.queryByTitle('source-9')).not.toBeInTheDocument();
    expect(screen.queryByTitle('src/fixture-5.ts')).not.toBeInTheDocument();
    expect(screen.getByText('قراءة جزئية')).toBeInTheDocument();
    expect(screen.getByTitle('src/fixture-0.ts')).toHaveAttribute('dir', 'ltr');
    expect(screen.getAllByText('10–24')[0]).toHaveAttribute('dir', 'ltr');
    expect(screen.getAllByText('يدعم')).toHaveLength(8);
    const toggle = screen.getByRole('button', { name: 'تفاصيل ترابط الأدلة' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'عرض خريطة الأدلة الموسعة' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTitle('source-9')).toBeInTheDocument();
    expect(screen.getByTitle('src/fixture-5.ts')).toBeInTheDocument();
    expect(screen.getAllByText('يدعم')).toHaveLength(10);
    expect(screen.getByTitle('file:0 SUPPORTS claim:result')).toHaveTextContent('0يدعمresult');
    fireEvent.click(toggle);
    expect(screen.queryByTitle('source-9')).not.toBeInTheDocument();
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('retains unknown metadata without inventing a proven verdict', () => {
    const graph = {
      ...emptyGraph(),
      nodes: [{ id: 'future:one', kind: 'FUTURE_KIND', label: 'Untranslated label', status: 'FUTURE_STATUS' }],
      edges: [{ id: 'future:edge', from: 'future:one', to: 'future:two', relation: 'FUTURE_RELATION' }],
    } as unknown as EvidenceGraph;
    render(<EvidenceGraphPanel graph={graph} />);
    expect(screen.getByText('FUTURE_KIND')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('FUTURE_STATUS')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('FUTURE_RELATION')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(/حالة غير معروفة:/)).toBeInTheDocument();
    expect(screen.queryByText('مثبت بحسب السجل')).not.toBeInTheDocument();
  });
});
