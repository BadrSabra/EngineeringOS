import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { auditExportFailureMessage, auditExportFilename, type AuditPreview } from './execution-proof';

export function useExecutionAudit(executionId: string | undefined) {
  const { toast } = useToast();
  const [auditExportPending, setAuditExportPending] = useState(false);
  const [auditPreviewPending, setAuditPreviewPending] = useState(false);
  const [auditPreview, setAuditPreview] = useState<AuditPreview | null>(null);
  const [auditPreviewError, setAuditPreviewError] = useState<string | null>(null);

  useEffect(() => {
    setAuditPreview(null);
    setAuditPreviewError(null);
  }, [executionId]);

  async function fetchExecutionAudit(): Promise<{ audit: AuditPreview; filename: string }> {
    if (!executionId) throw new Error('No completed execution is selected.');
    const response = await fetch(`/api/ai/executions/${encodeURIComponent(executionId)}/audit-export`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || 'The execution audit could not be loaded.');
    }
    return {
      audit: await response.json() as AuditPreview,
      filename: auditExportFilename(
        response.headers.get('Content-Disposition'),
        `execution-${executionId}-audit.json`,
      ),
    };
  }

  async function previewExecutionAudit() {
    if (!executionId || auditPreviewPending || auditExportPending) return;
    setAuditPreviewPending(true);
    setAuditPreviewError(null);
    try {
      const { audit } = await fetchExecutionAudit();
      setAuditPreview(audit);
    } catch (error) {
      setAuditPreviewError('temporary_network_failure');
      toast({
        title: 'تعذّرت معاينة سجل التدقيق مؤقتًا',
        description: 'تحقّق من الاتصال ثم أعد محاولة المعاينة للتشغيل ونسخة المشروع نفسيهما.',
        variant: 'destructive',
      });
    } finally {
      setAuditPreviewPending(false);
    }
  }

  async function exportExecutionAudit() {
    if (!executionId || auditExportPending || auditPreviewPending) return;
    setAuditExportPending(true);
    try {
      const { audit, filename } = await fetchExecutionAudit();
      const blob = new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast({
        title: 'تم تنزيل سجل التدقيق',
        description: 'سجل التدقيق المنقّح جاهز للمشاركة.',
      });
    } catch (error) {
      toast({
        title: 'تعذّر تنزيل سجل التدقيق',
        description: auditExportFailureMessage(error),
        variant: 'destructive',
      });
    } finally {
      setAuditExportPending(false);
    }
  }

  return {
    auditExportPending,
    auditPreviewPending,
    auditPreview,
    auditPreviewError,
    setAuditPreview,
    setAuditPreviewError,
    previewExecutionAudit,
    exportExecutionAudit,
  };
}
