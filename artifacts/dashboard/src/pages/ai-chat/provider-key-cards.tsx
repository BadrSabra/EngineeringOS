import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Key, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useDeleteDeepSeekKey, useDeleteGeminiKey, useDeleteGroqKey, useDeleteOpenRouterKey, useGetDeepSeekKeyStatus, useGetGroqKeyStatus, useGetOpenRouterKeyStatus, useGetProviderKeyStatus, useSaveDeepSeekKey, useSaveGeminiKey, useSaveGroqKey, useSaveOpenRouterKey } from '@workspace/api-client-react';
import { type DeepSeekKeyStatus, type GeminiKeyStatus, type GroqKeyStatus, GroqModelAvailabilityNotice, type OpenRouterKeyStatus, ProviderLifecycleNotice, ProviderRuntimeBadge, type ProviderRuntimeMetric, describeAiError } from './provider-runtime';

export function DeepSeekKeyCard({ runtimeMetric, disabled = true }: { runtimeMetric?: ProviderRuntimeMetric; disabled?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [keyInput, setKeyInput] = useState('');
  const [showInput, setShowInput] = useState(false);

  const { data: status, isLoading } = useGetDeepSeekKeyStatus<DeepSeekKeyStatus>({
    query: {
      queryKey: ['deepseek-key-status'],
    },
  });

  const saveMutation = useSaveDeepSeekKey({
    mutation: {
      onSuccess: (data) => {
        void qc.setQueryData(['deepseek-key-status'], data);
        void qc.invalidateQueries({ queryKey: ['active-provider'] });
        setKeyInput('');
        setShowInput(false);
        toast({ title: 'حُفظ مفتاح DeepSeek', description: `نهايته ···${data.last4}` });
      },
      onError: (err) => {
        toast({ title: 'تعذر حفظ المفتاح', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  const deleteMutation = useDeleteDeepSeekKey({
    mutation: {
      onSuccess: () => {
        void qc.setQueryData(['deepseek-key-status'], { configured: false, last4: null, updatedAt: null });
        void qc.invalidateQueries({ queryKey: ['active-provider'] });
        toast({ title: 'أُزيل مفتاح DeepSeek الشخصي' });
      },
      onError: (err) => {
        toast({ title: 'تعذر إزالة المفتاح', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  function handleSave() {
    const trimmed = keyInput.trim();
    if (trimmed.length < 10) {
      toast({ title: 'المفتاح أقصر من الحد المطلوب', description: 'أدخل مفتاح وصول صالحًا إلى DeepSeek في هذا الحقل.', variant: 'destructive' });
      return;
    }
    saveMutation.mutate({ data: { apiKey: trimmed } });
  }

  return (
    <div dir="rtl" lang="ar" className="provider-key-card mx-2 mb-2 min-w-0 overflow-hidden rounded-lg border border-border bg-secondary/50 p-3 text-xs">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 mb-2">
        <Key className="w-3 h-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-muted-foreground">مفتاح DeepSeek</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">غير مفعّل</span>
      </div>
      {disabled && (
        <p className="mb-2 break-words text-muted-foreground">
          هذا المزود غير مفعّل؛ لا تُرسل إليه أي طلبات. يمكنك إزالة المفتاح المحفوظ أدناه.
        </p>
      )}

      {isLoading ? (
        <p className="text-muted-foreground">جارٍ تحميل حالة المفتاح…</p>
      ) : status?.configured ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-green-500">
            <Check className="w-3 h-3" />
            <span dir="ltr" className="break-all">···{status.last4}</span>
          </div>
          <div className="flex shrink-0 gap-1">
            {!disabled && (
              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs max-md:min-h-7 max-md:px-2" aria-label="تغيير مفتاح DeepSeek" onClick={() => setShowInput((v) => !v)}>
                تغيير
              </Button>
            )}
            <Button
              size="sm" variant="ghost"
              className="h-5 px-1.5 text-xs text-destructive hover:text-destructive max-md:min-h-7 max-md:px-2"
              aria-label="إزالة مفتاح DeepSeek الشخصي"
              title="إزالة مفتاح DeepSeek الشخصي"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      ) : (
        <p className="mb-2 break-words text-muted-foreground">
          {disabled
            ? 'لا يلزم مفتاح DeepSeek؛ المسار المدعوم حاليًا هو نماذج OpenRouter المجانية فقط.'
            : <>يمكنك إدارة مفتاح DeepSeek عبر <bdi dir="ltr" className="font-mono break-all">platform.deepseek.com</bdi> ثم إدخاله هنا لاستخدام المزود.</>}
        </p>
      )}

      <ProviderRuntimeBadge metric={runtimeMetric} />

      {!disabled && (showInput || !status?.configured) && (
        <div className="flex min-w-0 gap-1 mt-2">
          <Input
            type="password"
            aria-label="مفتاح الوصول إلى DeepSeek"
            dir="ltr"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-…"
            className="h-7 min-w-0 basis-0 text-xs font-mono bg-background border-border flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            autoComplete="new-password"
          />
          <Button
            size="sm" className="h-7 px-2 text-xs"
            aria-label="حفظ مفتاح DeepSeek"
            onClick={handleSave}
            disabled={saveMutation.isPending || !keyInput.trim()}
          >
            {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'حفظ'}
          </Button>
        </div>
      )}
    </div>
  );
}

export function GroqKeyCard({ runtimeMetric, disabled = true }: { runtimeMetric?: ProviderRuntimeMetric; disabled?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [keyInput, setKeyInput] = useState('');
  const [showInput, setShowInput] = useState(false);

  const { data: status, isLoading } = useGetGroqKeyStatus<GroqKeyStatus>({
    query: {
      queryKey: ['groq-key-status'],
    },
  });

  const saveMutation = useSaveGroqKey({
    mutation: {
      onSuccess: (data) => {
        void qc.setQueryData(['groq-key-status'], data);
        void qc.invalidateQueries({ queryKey: ['groq-key-status'] });
        void qc.invalidateQueries({ queryKey: ['ai-metrics'] });
        void qc.invalidateQueries({ queryKey: ['active-provider'] });
        setKeyInput('');
        setShowInput(false);
        toast({ title: 'حُفظ مفتاح Groq', description: `نهايته ···${data.last4}` });
      },
      onError: (err) => {
        toast({ title: 'تعذر حفظ المفتاح', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  const deleteMutation = useDeleteGroqKey({
    mutation: {
      onSuccess: () => {
        void qc.setQueryData(['groq-key-status'], { configured: false, last4: null, updatedAt: null });
        void qc.invalidateQueries({ queryKey: ['groq-key-status'] });
        void qc.invalidateQueries({ queryKey: ['ai-metrics'] });
        void qc.invalidateQueries({ queryKey: ['active-provider'] });
        toast({ title: 'أُزيل مفتاح Groq الشخصي', description: 'هذا المفتاح لم يعد مستخدمًا؛ المسار المتاح هو OpenRouter المجاني فقط.' });
      },
      onError: (err) => {
        toast({ title: 'تعذر إزالة المفتاح', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  function handleSave() {
    const trimmed = keyInput.trim();
    if (trimmed.length < 10) {
      toast({ title: 'المفتاح أقصر من الحد المطلوب', description: 'أدخل مفتاح وصول صالحًا إلى Groq في هذا الحقل.', variant: 'destructive' });
      return;
    }
    saveMutation.mutate({ data: { apiKey: trimmed } });
  }

  return (
    <div dir="rtl" lang="ar" className="provider-key-card mx-2 mb-2 min-w-0 overflow-hidden rounded-lg border border-border bg-secondary/50 p-3 text-xs">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 mb-2">
        <Key className="w-3 h-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-muted-foreground">مفتاح Groq</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">غير مفعّل</span>
      </div>
      {disabled && (
        <p className="mb-2 break-words text-muted-foreground">
          هذا المزود غير مفعّل؛ لا تُرسل إليه أي طلبات. يمكنك إزالة المفتاح المحفوظ أدناه.
        </p>
      )}

      {isLoading ? (
        <p className="text-muted-foreground">جارٍ تحميل حالة المفتاح…</p>
      ) : status?.configured ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-green-500">
            <Check className="w-3 h-3" />
            <span dir="ltr" className="break-all">···{status.last4}</span>
          </div>
          <div className="flex shrink-0 gap-1">
            {!disabled && (
              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs max-md:min-h-7 max-md:px-2" aria-label="تغيير مفتاح Groq" onClick={() => setShowInput((v) => !v)}>
                تغيير
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1.5 text-xs text-destructive hover:text-destructive max-md:min-h-7 max-md:px-2"
              aria-label="إزالة مفتاح Groq الشخصي"
              title="إزالة مفتاح Groq الشخصي"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      ) : (
        <p className="mb-2 break-words text-muted-foreground">
          {disabled
            ? 'لا يلزم مفتاح Groq؛ المسار المدعوم حاليًا هو نماذج OpenRouter المجانية فقط.'
            : 'لا يوجد مفتاح شخصي محفوظ؛ يُستخدم مفتاح الخادم إن كان معدًّا.'}
        </p>
      )}

      {!disabled && <GroqModelAvailabilityNotice availability={status?.modelAvailability} />}
      <ProviderLifecycleNotice lifecycle={status?.lifecycle} />
      <ProviderRuntimeBadge metric={runtimeMetric} />

      {!disabled && (showInput || !status?.configured) && (
        <div className="flex min-w-0 gap-1 mt-2">
          <Input
            type="password"
            aria-label="مفتاح الوصول إلى Groq"
            dir="ltr"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="gsk_…"
            className="h-7 min-w-0 basis-0 text-xs font-mono bg-background border-border flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            autoComplete="new-password"
          />
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            aria-label="حفظ مفتاح Groq"
            onClick={handleSave}
            disabled={saveMutation.isPending || !keyInput.trim()}
          >
            {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'حفظ'}
          </Button>
        </div>
      )}
    </div>
  );
}

export function GeminiKeyCard({ runtimeMetric, disabled = true }: { runtimeMetric?: ProviderRuntimeMetric; disabled?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [keyInput, setKeyInput] = useState('');
  const [showInput, setShowInput] = useState(false);

  const { data: status, isLoading } = useGetProviderKeyStatus<GeminiKeyStatus>('gemini', {
    query: {
      queryKey: ['gemini-key-status'],
    },
  });

  const saveMutation = useSaveGeminiKey({
    mutation: {
      onSuccess: (data) => {
        void qc.setQueryData(['gemini-key-status'], data);
        void qc.invalidateQueries({ queryKey: ['active-provider'] });
        setKeyInput('');
        setShowInput(false);
        toast({ title: 'حُفظ مفتاح Gemini', description: `نهايته ···${data.last4}` });
      },
      onError: (err) => {
        toast({ title: 'تعذر حفظ المفتاح', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  const deleteMutation = useDeleteGeminiKey({
    mutation: {
      onSuccess: () => {
        void qc.setQueryData(['gemini-key-status'], { configured: false, last4: null, updatedAt: null });
        void qc.invalidateQueries({ queryKey: ['active-provider'] });
        toast({ title: 'أُزيل مفتاح Gemini الشخصي' });
      },
      onError: (err) => {
        toast({ title: 'تعذر إزالة المفتاح', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  function handleSave() {
    const trimmed = keyInput.trim();
    if (trimmed.length < 10) {
      toast({ title: 'المفتاح أقصر من الحد المطلوب', description: 'أدخل مفتاح وصول صالحًا إلى Gemini في هذا الحقل.', variant: 'destructive' });
      return;
    }
    saveMutation.mutate({ data: { apiKey: trimmed } });
  }

  return (
    <div dir="rtl" lang="ar" className="provider-key-card mx-2 mb-2 min-w-0 overflow-hidden rounded-lg border border-border bg-secondary/50 p-3 text-xs">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 mb-2">
        <Key className="w-3 h-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-muted-foreground">مفتاح Gemini</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">غير مفعّل</span>
      </div>
      {disabled && (
        <p className="mb-2 break-words text-muted-foreground">
          هذا المزود غير مفعّل؛ لا تُرسل إليه أي طلبات. يمكنك إزالة المفتاح المحفوظ أدناه.
        </p>
      )}

      {isLoading ? (
        <p className="text-muted-foreground">جارٍ تحميل حالة المفتاح…</p>
      ) : status?.configured ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-green-500">
            <Check className="w-3 h-3" />
            <span dir="ltr" className="break-all">···{status.last4}</span>
          </div>
          <div className="flex shrink-0 gap-1">
            {!disabled && (
              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs max-md:min-h-7 max-md:px-2" aria-label="تغيير مفتاح Gemini" onClick={() => setShowInput((v) => !v)}>
                تغيير
              </Button>
            )}
            <Button
              size="sm" variant="ghost"
              className="h-5 px-1.5 text-xs text-destructive hover:text-destructive max-md:min-h-7 max-md:px-2"
              aria-label="إزالة مفتاح Gemini الشخصي"
              title="إزالة مفتاح Gemini الشخصي"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      ) : (
        <p className="mb-2 break-words text-muted-foreground">
          {disabled
            ? 'لا يلزم مفتاح Gemini؛ المسار المدعوم حاليًا هو نماذج OpenRouter المجانية فقط.'
            : <>يمكنك إدارة مفتاح Gemini عبر <bdi dir="ltr" className="font-mono break-all">aistudio.google.com/apikey</bdi> ثم إدخاله هنا. تخضع حدود الاستخدام لحسابك لدى المزود.</>}
        </p>
      )}

      <ProviderLifecycleNotice lifecycle={status?.lifecycle} />
      <ProviderRuntimeBadge metric={runtimeMetric} />

      {!disabled && (showInput || !status?.configured) && (
        <div className="flex min-w-0 gap-1 mt-2">
          <Input
            type="password"
            aria-label="مفتاح الوصول إلى Gemini"
            dir="ltr"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="AIza…"
            className="h-7 min-w-0 basis-0 text-xs font-mono bg-background border-border flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            autoComplete="new-password"
          />
          <Button
            size="sm"
            className="h-7 text-xs px-2"
            aria-label="حفظ مفتاح Gemini"
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            حفظ
          </Button>
        </div>
      )}
    </div>
  );
}

export function OpenRouterKeyCard({ runtimeMetric }: { runtimeMetric?: ProviderRuntimeMetric }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [keyInput, setKeyInput] = useState('');
  const [showInput, setShowInput] = useState(false);

  const { data: status, isLoading } = useGetOpenRouterKeyStatus<OpenRouterKeyStatus>({
    query: {
      queryKey: ['openrouter-key-status'],
    },
  });

  const saveMutation = useSaveOpenRouterKey({
    mutation: {
      onSuccess: (data) => {
        void qc.setQueryData(['openrouter-key-status'], data);
        void qc.invalidateQueries({ queryKey: ['active-provider'] });
        setKeyInput('');
        setShowInput(false);
        toast({
          title: 'حُفظ مفتاح OpenRouter',
          description: `نهايته ···${data.last4} — لم نرسل طلب توليد اختباريًا.`,
        });
      },
      onError: (err) => {
        toast({ title: 'تعذر حفظ المفتاح', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  const deleteMutation = useDeleteOpenRouterKey({
    mutation: {
      onSuccess: () => {
        void qc.setQueryData(['openrouter-key-status'], { configured: false, last4: null, updatedAt: null });
        void qc.invalidateQueries({ queryKey: ['active-provider'] });
        toast({ title: 'أُزيل مفتاح OpenRouter الشخصي' });
      },
      onError: (err) => {
        toast({ title: 'تعذر إزالة المفتاح', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  function handleSave() {
    const trimmed = keyInput.trim();
    if (trimmed.length < 10) {
      toast({ title: 'المفتاح أقصر من الحد المطلوب', description: 'أدخل مفتاح وصول صالحًا إلى OpenRouter في هذا الحقل.', variant: 'destructive' });
      return;
    }
    saveMutation.mutate({ data: { apiKey: trimmed } });
  }

  return (
    <div dir="rtl" lang="ar" className="provider-key-card mx-2 mb-2 min-w-0 overflow-hidden rounded-lg border border-border bg-secondary/50 p-3 text-xs">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 mb-2">
        <Key className="w-3 h-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-muted-foreground">مفتاح OpenRouter</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">أولوية</span>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">جارٍ تحميل حالة المفتاح…</p>
      ) : status?.configured ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-green-500">
            <Check className="w-3 h-3" />
            <span dir="ltr" className="break-all">···{status.last4}</span>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs max-md:min-h-7 max-md:px-2" aria-label="تغيير مفتاح OpenRouter" onClick={() => setShowInput((v) => !v)}>
              تغيير
            </Button>
            <Button
              size="sm" variant="ghost"
              className="h-5 px-1.5 text-xs text-destructive hover:text-destructive max-md:min-h-7 max-md:px-2"
              aria-label="إزالة مفتاح OpenRouter الشخصي"
              title="إزالة مفتاح OpenRouter الشخصي"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      ) : (
        <p className="mb-2 break-words text-muted-foreground">
          يمكنك إدارة مفاتيح OpenRouter عبر <bdi dir="ltr" className="font-mono break-all">openrouter.ai/keys</bdi> ثم إدخال مفتاحك هنا. يستخدم التطبيق النماذج المجانية المؤهلة فقط ولا ينتقل إلى مزود آخر أو نموذج مدفوع.
        </p>
      )}

      <ProviderLifecycleNotice lifecycle={status?.lifecycle} />
      <p className="mt-1.5 break-words text-xs leading-5 text-muted-foreground">
        حفظ المفتاح لا يرسل طلب توليد. حالة النماذج مأخوذة من الكتالوج ولا تضمن نجاح التوليد عند التنفيذ.
      </p>
      <ProviderRuntimeBadge metric={runtimeMetric} />

      {(showInput || !status?.configured) && (
        <div className="flex min-w-0 gap-1 mt-2">
          <Input
            type="password"
            aria-label="مفتاح الوصول إلى OpenRouter"
            dir="ltr"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-or-…"
            className="h-7 min-w-0 basis-0 text-xs font-mono bg-background border-border flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            autoComplete="new-password"
          />
          <Button
            size="sm" className="h-7 px-2 text-xs"
            aria-label="حفظ مفتاح OpenRouter"
            onClick={handleSave}
            disabled={saveMutation.isPending || !keyInput.trim()}
          >
            {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'حفظ'}
          </Button>
        </div>
      )}
    </div>
  );
}
