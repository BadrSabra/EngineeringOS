import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readGoalDrafts, storeHomeGoalDraft } from '@/lib/home-goal-handoff';
import GraphAssistantHandoff from './GraphAssistantHandoff';

const mocks = vi.hoisted(() => ({
  isLoaded: true,
  user: { id: 'user-1' } as { id: string } | null,
  setLocation: vi.fn(),
}));

vi.mock('@clerk/react', () => ({
  useUser: () => ({ isLoaded: mocks.isLoaded, user: mocks.user }),
}));

vi.mock('wouter', () => ({
  useLocation: () => ['/graph', mocks.setLocation],
}));

const entity = {
  id: 'entity-1',
  projectId: 'project/alpha',
  type: 'function',
  name: 'buildGraph\nhelper',
  path: 'src/graph.ts',
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  mocks.isLoaded = true;
  mocks.user = { id: 'user-1' };
});

describe('GraphAssistantHandoff', () => {
  it('opens a scoped, reviewable assistant draft for the selected graph entity', () => {
    render(<GraphAssistantHandoff entity={entity} projectId="project/alpha" />);

    fireEvent.click(screen.getByTestId('button-graph-assistant-handoff-entity-1'));

    const draft = readGoalDrafts('user-1').drafts[0];
    expect(draft).toMatchObject({
      source: 'home',
      projectId: 'project/alpha',
    });
    expect(draft.text).toContain('العنصر «buildGraph helper»');
    expect(draft.text).toContain('نوع العنصر: function.');
    expect(draft.text).toContain('مساره: src/graph.ts.');
    expect(draft.text).toContain('تحقق من ملفات المشروع قبل الاستنتاج.');
    expect(draft.text).toContain('لا تغيّر ملفات المشروع ولا تبدأ التنفيذ قبل موافقتي.');
    expect(mocks.setLocation).toHaveBeenCalledWith(
      `/projects/project%2Falpha/workspace?goalDraftId=${draft.id}#workspace-panel-agent`,
    );
  });

  it('does not offer a handoff for a different project or an unloaded user', () => {
    const { rerender } = render(
      <GraphAssistantHandoff entity={entity} projectId="project/beta" />,
    );
    expect(screen.queryByTestId('graph-assistant-handoff')).not.toBeInTheDocument();

    mocks.isLoaded = false;
    rerender(<GraphAssistantHandoff entity={entity} projectId="project/alpha" />);
    expect(screen.queryByTestId('graph-assistant-handoff')).not.toBeInTheDocument();
  });

  it('stays on the graph page if the draft cannot be saved', () => {
    for (let index = 0; index < 8; index += 1) {
      expect(storeHomeGoalDraft(`هدف ${index}`, 'user-1')).not.toBeNull();
    }
    render(<GraphAssistantHandoff entity={entity} projectId="project/alpha" />);

    fireEvent.click(screen.getByTestId('button-graph-assistant-handoff-entity-1'));

    expect(screen.getByRole('alert')).toHaveTextContent('تعذر حفظ سياق العنصر.');
    expect(mocks.setLocation).not.toHaveBeenCalled();
    expect(readGoalDrafts('user-1').drafts).toHaveLength(8);
  });
});
