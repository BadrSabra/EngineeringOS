import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MissionActionDialog, { type MissionActionConfirmation } from './MissionActionDialog';

const approval: MissionActionConfirmation = {
  type: 'approve', missionId: 'mission-1', missionTitle: 'هدف الإصدار',
  goalId: 'goal-1', goalTitle: 'مراجعة src/App.tsx', projectId: 'project-1',
  executionId: 'execution-1',
};
const planApproval: MissionActionConfirmation = {
  ...approval,
  executionId: null,
  planRevision: 'a'.repeat(64),
};

describe('Arabic decision confirmation boundaries', () => {
  it('opens a review without approving, preserves identities, and makes cancellation inert', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<MissionActionDialog action={approval} isPending={false} error={null} onConfirm={onConfirm} onClose={onClose} />);
    expect(screen.getByRole('alertdialog')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText(/لا تطبّق الملفات أو تسلّمها بذاتها/)).toBeInTheDocument();
    const titles = screen.getAllByText('مراجعة src/App.tsx');
    expect(titles).toHaveLength(2);
    titles.forEach((title) => expect(title).toHaveAttribute('dir', 'auto'));
    expect(screen.getByTestId('link-review-mission-approval')).toHaveAttribute('href', '/mission-control?projectId=project-1&missionId=mission-1&executionId=execution-1');
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('requires an explicit confirmation and prevents further clicks while pending', () => {
    const onConfirm = vi.fn();
    const props = { action: approval, error: null, onClose: vi.fn(), onConfirm };
    const { rerender } = render(<MissionActionDialog {...props} isPending={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'الموافقة والاستئناف' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    rerender(<MissionActionDialog {...props} isPending />);
    expect(screen.getByTestId('button-confirm-mission-action')).toBeDisabled();
    expect(screen.getByTestId('button-cancel-mission-action')).toBeDisabled();
    fireEvent.click(screen.getByTestId('button-confirm-mission-action'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('distinguishes plan approval from proposal approval and binds the displayed revision', () => {
    render(<MissionActionDialog action={planApproval} isPending={false} error={null} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/تعتمد نسخة الخطة التالية وتبدأ خطوة محدودة لإعداد المرشح/)).toBeInTheDocument();
    expect(screen.getByText('a'.repeat(64))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'اعتماد الخطة وبدء التنفيذ' })).toBeInTheDocument();
    expect(screen.queryByTestId('link-review-mission-approval')).not.toBeInTheDocument();
  });

  it('distinguishes replanning from approval, retains history warning, and preserves server errors', () => {
    render(<MissionActionDialog action={{ type: 'replan', missionId: 'mission-1', missionTitle: 'الهدف' }} isPending={false} error="Revision mismatch" onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('إنشاء نسخة جديدة من الخطة؟')).toBeInTheDocument();
    expect(screen.getByText(/تبقى الخطوات والأدلة السابقة في سجل الهدف/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Revision mismatch');
    expect(screen.getByRole('alert')).toHaveAttribute('dir', 'auto');
    expect(screen.queryByTestId('link-review-mission-approval')).not.toBeInTheDocument();
  });
});
