import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import { Bot, Send, Plus, ChevronDown, Loader2, User, Zap, Search, Code2, GitMerge, Key, Trash2, Check, FileCode2, ChevronRight, X, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  useListProjects,
  getListProjectsQueryKey,
  classifyProjectError,
  isRetryableProjectError,
  emitProjectLoadFailed,
  useAiChatStream,
  useAiAnalyzeProject,
  useAiReviewCode,
} from '@workspace/api-client-react';
import type { AiStreamErrorEvent, AiScanAnalysis, AiCodeReview } from '@workspace/api-client-react';
// PR-06: import shared fetch helpers and error class from lib/api-fetch so
// the duplicate implementations in AiChat and GitPanel are unified.
import { ApiError, apiPost, apiGet, apiPut, apiDelete } from '@/lib/api-fetch';

type Project = { id: string; name: string; language: string };
type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; sources?: string; createdAt: string };
type Session = { id: string; title: string; updatedAt: string };
type ProviderKeyStatus  = { configured: boolean; last4: string | null; updatedAt: string | null };
type GroqKeyStatus      = ProviderKeyStatus;
type DeepSeekKeyStatus  = ProviderKeyStatus;
type OpenRouterKeyStatus = ProviderKeyStatus;
type GeminiKeyStatus    = ProviderKeyStatus;
type ActiveProvider     = { provider: 'groq' | 'deepseek' | 'openrouter' | 'gemini' | null; configured: boolean };

/** PR-06: runtime health snapshot returned by /api/ai/metrics */
type ProviderRuntimeMetric = {
  provider: string;
  requests: number;
  failures: number;
  successRate: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  avgLatencyMs: number | null;
  circuitOpen: boolean;
  circuitHalfOpen: boolean;
  cooldownRemainingMs: number | null;
};
type MetricsResponse = { metrics: ProviderRuntimeMetric[] };
type PendingChange = {
  path: string;
  absolutePath: string;
  newContent: string;
  originalContent: string | null;
  reason: string;
};

// PR-06: AiApiError replaced by the shared ApiError from lib/api-fetch.
// Alias retained only to avoid renaming the one remaining internal reference.
const AiApiError = ApiError;

/**
 * PR-06: Compact runtime status badge for a provider card.
 * Shows circuit state, consecutive failures, last success, and avg latency.
 */
function ProviderRuntimeBadge({ metric }: { metric: ProviderRuntimeMetric | undefined }) {
  if (!metric || metric.requests === 0) return null;

  const cooldownSec = metric.cooldownRemainingMs != null
    ? Math.ceil(metric.cooldownRemainingMs / 1000)
    : null;

  const lastSuccessLabel = metric.lastSuccessAt
    ? (() => {
        const secs = Math.floor((Date.now() - new Date(metric.lastSuccessAt).getTime()) / 1000);
        if (secs < 60)   return `${secs}s ago`;
        if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
        return `${Math.floor(secs / 3600)}h ago`;
      })()
    : null;

  if (metric.circuitOpen) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-red-400">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
        <span>Circuit open{cooldownSec != null ? ` · ${cooldownSec}s cooldown` : ''}</span>
      </div>
    );
  }

  const isHealthy = metric.consecutiveFailures === 0 && metric.successRate != null && metric.successRate > 0.8;
  const isDegraded = metric.consecutiveFailures > 0 || (metric.successRate != null && metric.successRate < 0.8);

  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isHealthy ? 'bg-green-400' : isDegraded ? 'bg-yellow-400' : 'bg-muted-foreground'}`} />
      <span className="flex-1 truncate">
        {metric.consecutiveFailures > 0
          ? `${metric.consecutiveFailures} consecutive fail${metric.consecutiveFailures > 1 ? 's' : ''}`
          : lastSuccessLabel
            ? `OK · ${lastSuccessLabel}`
            : 'Active'}
        {metric.avgLatencyMs != null ? ` · ${metric.avgLatencyMs}ms` : ''}
      </span>
    </div>
  );
}

/**
 * Maps an AiApiError (or any error) to a concise, user-facing string.
 * Status codes align with what ai.ts returns after handleOrchestratorError.
 */
/** STORY-04: human-readable label for an OpenRouter model ID. */
const OR_MODEL_LABELS: Record<string, string> = {
  "meta-llama/llama-3.3-70b-instruct:free": "Llama 3.3 70B",
  "meta-llama/llama-3.1-8b-instruct:free":  "Llama 3.1 8B",
  "deepseek/deepseek-r1:free":               "DeepSeek R1",
  "qwen/qwen3-235b-a22b:free":               "Qwen3 235B",
  "qwen/qwen3-8b:free":                      "Qwen3 8B",
  "qwen/qwen3-30b-a3b:free":                 "Qwen3 30B",
  "mistralai/mistral-7b-instruct:free":      "Mistral 7B",
  "google/gemma-3-27b-it:free":              "Gemma 3 27B",
  "google/gemma-3-12b-it:free":              "Gemma 3 12B",
};
function fmtModelId(id: string): string {
  return OR_MODEL_LABELS[id] ?? (id.split("/").pop()?.replace(/:free$/, "") ?? id);
}

function describeAiError(err: unknown): string {
  if (err instanceof AiApiError) {
    switch (err.status) {
      case 400: return err.errorMessage;
      case 401: return err.errorMessage || err.hint || 'AI API key is invalid — delete it and save a valid key from your provider\'s dashboard.';
      case 403: return 'Access denied — you may not have permission on this project.';
      case 429: return err.errorMessage || err.hint || 'AI rate limit reached — wait 30–60 seconds before retrying.';
      case 422:
        if (err.code === 'model_output_invalid') {
          return 'The AI returned an unexpected response format — try rephrasing your message.';
        }
        if (err.code === 'MODEL_NOT_FOUND') {
          return err.errorMessage || err.hint || 'The selected AI model is unavailable — try again or switch providers.';
        }
        return err.errorMessage || err.hint || 'AI provider configuration is invalid. Re-save your API key.';
      case 428: return err.errorMessage || err.hint || 'No AI key configured — save an OpenRouter, DeepSeek, or Groq API key first.';
      case 502: return err.errorMessage || err.hint || 'AI provider returned an error. Check your API key or try again.';
      case 503: return 'AI provider is temporarily unreachable — try again in a moment.';
      default:  return err.errorMessage || `Request failed (${err.status}).`;
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

// AI-specific endpoints use cookie-based Clerk auth (same-origin — no Bearer needed).
// apiFetch, apiPost, apiGet, apiPut, apiDelete are imported from lib/api-fetch (PR-06).

/**
 * Safely parse the `sources` field from a chat message.
 * The field is stored as a JSON string in the DB; malformed or missing payloads
 * must never crash the UI — return an empty array as the fallback.
 */
function parseSources(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function PendingChangesCard({
  changes,
  onApply,
  onReject,
  isPending,
}: {
  changes: PendingChange[];
  onApply: (changes: PendingChange[]) => void;
  onReject: () => void;
  isPending: boolean;
}) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  function toggleExpand(p: string) {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  return (
    <div className="max-w-3xl mx-auto mb-4">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-500/20 bg-amber-500/10">
          <FileCode2 className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-sm font-medium text-amber-400">
            {changes.length} proposed file change{changes.length !== 1 ? 's' : ''}
          </span>
          <span className="text-xs text-muted-foreground ml-auto">Waiting for your approval</span>
        </div>

        {/* Changes list */}
        <div className="divide-y divide-border/40">
          {changes.map((change) => {
            const isNew = change.originalContent === null;
            const isExpanded = expandedPaths.has(change.path);
            const newLines = change.newContent.split('\n').length;
            const oldLines = change.originalContent ? change.originalContent.split('\n').length : 0;

            return (
              <div key={change.path} className="px-4 py-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs font-mono text-foreground truncate max-w-[300px]">
                        {change.path}
                      </code>
                      {isNew ? (
                        <span className="text-xs px-1.5 py-0.5 rounded border border-green-500/30 text-green-400 bg-green-500/10">
                          new file
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {oldLines} → {newLines} lines
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {change.reason}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleExpand(change.path)}
                    className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded border border-border/50 hover:border-border shrink-0 transition-colors"
                  >
                    <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    {isExpanded ? 'Hide' : 'View'}
                  </button>
                </div>

                {isExpanded && (
                  <pre className="mt-2 rounded-lg bg-black/40 border border-border/40 p-3 text-xs font-mono overflow-x-auto max-h-72 overflow-y-auto text-foreground/80 leading-relaxed">
                    {change.newContent}
                  </pre>
                )}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-4 py-3 border-t border-amber-500/20">
          <Button
            size="sm"
            className="h-7 px-3 text-xs bg-amber-500 hover:bg-amber-600 text-black font-medium"
            onClick={() => onApply(changes)}
            disabled={isPending}
          >
            {isPending
              ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
              : <Check className="w-3 h-3 mr-1.5" />}
            Apply {changes.length} change{changes.length !== 1 ? 's' : ''}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-3 text-xs text-muted-foreground hover:text-foreground"
            onClick={onReject}
            disabled={isPending}
          >
            <X className="w-3 h-3 mr-1" />
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * UI-01: Last-resort display guard.
 * If the backend somehow passes a JSON envelope such as
 * {"response":"...","sources":[...]} as message content, extract and show
 * only the inner `response` string so the user never sees raw JSON in a bubble.
 */
function extractDisplayText(raw: string): string {
  if (!raw || !raw.trim().startsWith('{')) return raw;
  try {
    const parsed = JSON.parse(raw.trim());
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>)['response'] === 'string'
    ) {
      return ((parsed as Record<string, unknown>)['response'] as string).trim() || raw;
    }
  } catch {
    // Not valid JSON — display as-is.
  }
  return raw;
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  const sources = parseSources(msg.sources);
  // UI-01: strip any accidental JSON envelope before rendering.
  const displayContent = extractDisplayText(msg.content);

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} mb-4`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? 'bg-primary text-primary-foreground' : 'bg-secondary border border-border'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-primary" />}
      </div>
      <div className={`flex flex-col gap-1 max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-primary text-primary-foreground rounded-tr-sm whitespace-pre-wrap'
              : 'bg-secondary border border-border rounded-tl-sm prose prose-sm prose-invert max-w-none'
          }`}
        >
          {isUser ? displayContent : (
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
                li: ({ children }) => <li className="mb-0.5">{children}</li>,
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                code: ({ children }) => <code className="bg-black/20 rounded px-1 py-0.5 text-xs font-mono">{children}</code>,
                pre: ({ children }) => <pre className="bg-black/20 rounded p-2 overflow-x-auto text-xs font-mono mb-2">{children}</pre>,
                h1: ({ children }) => <h1 className="text-base font-bold mb-1">{children}</h1>,
                h2: ({ children }) => <h2 className="text-sm font-bold mb-1">{children}</h2>,
                h3: ({ children }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
              }}
            >
              {displayContent}
            </ReactMarkdown>
          )}
        </div>
        {sources.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {sources.map((s) => (
              <Badge key={s} variant="outline" className="text-xs font-mono text-muted-foreground">
                {s}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DeepSeekKeyCard({ runtimeMetric }: { runtimeMetric?: ProviderRuntimeMetric }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [keyInput, setKeyInput] = useState('');
  const [showInput, setShowInput] = useState(false);

  const { data: status, isLoading } = useQuery<DeepSeekKeyStatus>({
    queryKey: ['deepseek-key-status'],
    queryFn: () => apiGet<DeepSeekKeyStatus>('/api/ai/deepseek-key'),
  });

  const saveMutation = useMutation({
    mutationFn: (apiKey: string) => apiPut<DeepSeekKeyStatus>('/api/ai/deepseek-key', { apiKey }),
    onSuccess: (data) => {
      void qc.setQueryData(['deepseek-key-status'], data);
      void qc.invalidateQueries({ queryKey: ['active-provider'] });
      setKeyInput('');
      setShowInput(false);
      toast({ title: 'DeepSeek key saved', description: `Ends in ···${data.last4}` });
    },
    onError: (err) => {
      toast({ title: 'Failed to save key', description: describeAiError(err), variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiDelete<{ configured: boolean }>('/api/ai/deepseek-key'),
    onSuccess: () => {
      void qc.setQueryData(['deepseek-key-status'], { configured: false, last4: null, updatedAt: null });
      void qc.invalidateQueries({ queryKey: ['active-provider'] });
      toast({ title: 'DeepSeek key removed' });
    },
    onError: (err) => {
      toast({ title: 'Failed to remove key', description: describeAiError(err), variant: 'destructive' });
    },
  });

  function handleSave() {
    const trimmed = keyInput.trim();
    if (trimmed.length < 10) {
      toast({ title: 'Key too short', description: 'Enter a valid DeepSeek API key.', variant: 'destructive' });
      return;
    }
    saveMutation.mutate(trimmed);
  }

  return (
    <div className="mx-2 mb-2 rounded-lg border border-border bg-secondary/50 p-3 text-xs">
      <div className="flex items-center gap-1.5 mb-2">
        <Key className="w-3 h-3 text-muted-foreground" />
        <span className="font-mono text-muted-foreground uppercase tracking-wider">DeepSeek API Key</span>
        <span className="ml-auto text-[10px] text-muted-foreground">Optional</span>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : status?.configured ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-green-500">
            <Check className="w-3 h-3" />
            <span>···{status.last4}</span>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs" onClick={() => setShowInput((v) => !v)}>
              Change
            </Button>
            <Button
              size="sm" variant="ghost"
              className="h-5 px-1.5 text-xs text-destructive hover:text-destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground mb-2">
          Get a free API key at <span className="font-mono">platform.deepseek.com</span> to use DeepSeek as your AI provider.
        </p>
      )}

      <ProviderRuntimeBadge metric={runtimeMetric} />

      {(showInput || !status?.configured) && (
        <div className="flex gap-1 mt-2">
          <Input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-…"
            className="h-7 text-xs font-mono bg-background border-border flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            autoComplete="new-password"
          />
          <Button
            size="sm" className="h-7 px-2 text-xs"
            onClick={handleSave}
            disabled={saveMutation.isPending || !keyInput.trim()}
          >
            {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}

function GroqKeyCard({ runtimeMetric }: { runtimeMetric?: ProviderRuntimeMetric }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [keyInput, setKeyInput] = useState('');
  const [showInput, setShowInput] = useState(false);

  const { data: status, isLoading } = useQuery<GroqKeyStatus>({
    queryKey: ['groq-key-status'],
    queryFn: () => apiGet<GroqKeyStatus>('/api/ai/groq-key'),
  });

  const saveMutation = useMutation({
    mutationFn: (apiKey: string) => apiPut<GroqKeyStatus>('/api/ai/groq-key', { apiKey }),
    onSuccess: (data) => {
      void qc.setQueryData(['groq-key-status'], data);
      setKeyInput('');
      setShowInput(false);
      toast({ title: 'Groq key saved', description: `Ends in ···${data.last4}` });
    },
    onError: (err) => {
      toast({ title: 'Failed to save key', description: describeAiError(err), variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiDelete<{ configured: boolean }>('/api/ai/groq-key'),
    onSuccess: () => {
      void qc.setQueryData(['groq-key-status'], { configured: false, last4: null, updatedAt: null });
      toast({ title: 'Groq key removed', description: 'Falling back to server default.' });
    },
    onError: (err) => {
      toast({ title: 'Failed to remove key', description: describeAiError(err), variant: 'destructive' });
    },
  });

  function handleSave() {
    const trimmed = keyInput.trim();
    if (trimmed.length < 10) {
      toast({ title: 'Key too short', description: 'Enter a valid Groq API key.', variant: 'destructive' });
      return;
    }
    saveMutation.mutate(trimmed);
  }

  return (
    <div className="mx-2 mb-2 rounded-lg border border-border bg-secondary/50 p-3 text-xs">
      <div className="flex items-center gap-1.5 mb-2">
        <Key className="w-3 h-3 text-muted-foreground" />
        <span className="font-mono text-muted-foreground uppercase tracking-wider">Groq API Key</span>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : status?.configured ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-green-500">
            <Check className="w-3 h-3" />
            <span>···{status.last4}</span>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs" onClick={() => setShowInput((v) => !v)}>
              Change
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1.5 text-xs text-destructive hover:text-destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground mb-2">No personal key saved — the server's key will be used if one is configured.</p>
      )}

      <ProviderRuntimeBadge metric={runtimeMetric} />

      {(showInput || !status?.configured) && (
        <div className="flex gap-1 mt-2">
          <Input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="gsk_…"
            className="h-7 text-xs font-mono bg-background border-border flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            autoComplete="new-password"
          />
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleSave}
            disabled={saveMutation.isPending || !keyInput.trim()}
          >
            {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}

function GeminiKeyCard({ runtimeMetric }: { runtimeMetric?: ProviderRuntimeMetric }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [keyInput, setKeyInput] = useState('');
  const [showInput, setShowInput] = useState(false);

  const { data: status, isLoading } = useQuery<GeminiKeyStatus>({
    queryKey: ['gemini-key-status'],
    queryFn: () => apiGet<GeminiKeyStatus>('/api/ai/providers/gemini/key'),
  });

  const saveMutation = useMutation({
    mutationFn: (apiKey: string) => apiPut<GeminiKeyStatus>('/api/ai/providers/gemini/key', { apiKey }),
    onSuccess: (data) => {
      void qc.setQueryData(['gemini-key-status'], data);
      void qc.invalidateQueries({ queryKey: ['active-provider'] });
      setKeyInput('');
      setShowInput(false);
      toast({ title: 'Gemini key saved', description: `Ends in ···${data.last4}` });
    },
    onError: (err) => {
      toast({ title: 'Failed to save key', description: describeAiError(err), variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiDelete<{ configured: boolean }>('/api/ai/providers/gemini/key'),
    onSuccess: () => {
      void qc.setQueryData(['gemini-key-status'], { configured: false, last4: null, updatedAt: null });
      void qc.invalidateQueries({ queryKey: ['active-provider'] });
      toast({ title: 'Gemini key removed' });
    },
    onError: (err) => {
      toast({ title: 'Failed to remove key', description: describeAiError(err), variant: 'destructive' });
    },
  });

  function handleSave() {
    const trimmed = keyInput.trim();
    if (trimmed.length < 10) {
      toast({ title: 'Key too short', description: 'Enter a valid Gemini API key.', variant: 'destructive' });
      return;
    }
    saveMutation.mutate(trimmed);
  }

  return (
    <div className="mx-2 mb-2 rounded-lg border border-border bg-secondary/50 p-3 text-xs">
      <div className="flex items-center gap-1.5 mb-2">
        <Key className="w-3 h-3 text-muted-foreground" />
        <span className="font-mono text-muted-foreground uppercase tracking-wider">Gemini API Key</span>
        <span className="ml-auto text-[10px] text-muted-foreground">Free · Priority</span>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : status?.configured ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-green-500">
            <Check className="w-3 h-3" />
            <span>···{status.last4}</span>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs" onClick={() => setShowInput((v) => !v)}>
              Change
            </Button>
            <Button
              size="sm" variant="ghost"
              className="h-5 px-1.5 text-xs text-destructive hover:text-destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground mb-2">
          Free key at <span className="font-mono">aistudio.google.com/apikey</span> — 1,500 req/day, 1M tokens/day.
        </p>
      )}

      <ProviderRuntimeBadge metric={runtimeMetric} />

      {(showInput || !status?.configured) && (
        <div className="flex gap-1 mt-2">
          <Input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="AIza…"
            className="h-7 text-xs font-mono bg-background border-border flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            autoComplete="new-password"
          />
          <Button
            size="sm"
            className="h-7 text-xs px-2"
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

function OpenRouterKeyCard({ runtimeMetric }: { runtimeMetric?: ProviderRuntimeMetric }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [keyInput, setKeyInput] = useState('');
  const [showInput, setShowInput] = useState(false);

  const { data: status, isLoading } = useQuery<OpenRouterKeyStatus>({
    queryKey: ['openrouter-key-status'],
    queryFn: () => apiGet<OpenRouterKeyStatus>('/api/ai/openrouter-key'),
  });

  const saveMutation = useMutation({
    mutationFn: (apiKey: string) => apiPut<OpenRouterKeyStatus>('/api/ai/openrouter-key', { apiKey }),
    onSuccess: (data) => {
      void qc.setQueryData(['openrouter-key-status'], data);
      void qc.invalidateQueries({ queryKey: ['active-provider'] });
      setKeyInput('');
      setShowInput(false);
      toast({ title: 'OpenRouter key saved', description: `Ends in ···${data.last4}` });
    },
    onError: (err) => {
      toast({ title: 'Failed to save key', description: describeAiError(err), variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiDelete<{ configured: boolean }>('/api/ai/openrouter-key'),
    onSuccess: () => {
      void qc.setQueryData(['openrouter-key-status'], { configured: false, last4: null, updatedAt: null });
      void qc.invalidateQueries({ queryKey: ['active-provider'] });
      toast({ title: 'OpenRouter key removed' });
    },
    onError: (err) => {
      toast({ title: 'Failed to remove key', description: describeAiError(err), variant: 'destructive' });
    },
  });

  function handleSave() {
    const trimmed = keyInput.trim();
    if (trimmed.length < 10) {
      toast({ title: 'Key too short', description: 'Enter a valid OpenRouter API key.', variant: 'destructive' });
      return;
    }
    saveMutation.mutate(trimmed);
  }

  return (
    <div className="mx-2 mb-2 rounded-lg border border-border bg-secondary/50 p-3 text-xs">
      <div className="flex items-center gap-1.5 mb-2">
        <Key className="w-3 h-3 text-muted-foreground" />
        <span className="font-mono text-muted-foreground uppercase tracking-wider">OpenRouter API Key</span>
        <span className="ml-auto text-[10px] text-muted-foreground">Priority</span>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : status?.configured ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-green-500">
            <Check className="w-3 h-3" />
            <span>···{status.last4}</span>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs" onClick={() => setShowInput((v) => !v)}>
              Change
            </Button>
            <Button
              size="sm" variant="ghost"
              className="h-5 px-1.5 text-xs text-destructive hover:text-destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground mb-2">
          Get a free key at <span className="font-mono">openrouter.ai/keys</span> — routes to 300+ models, used first when configured.
        </p>
      )}

      <ProviderRuntimeBadge metric={runtimeMetric} />

      {(showInput || !status?.configured) && (
        <div className="flex gap-1 mt-2">
          <Input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-or-…"
            className="h-7 text-xs font-mono bg-background border-border flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            autoComplete="new-password"
          />
          <Button
            size="sm" className="h-7 px-2 text-xs"
            onClick={handleSave}
            disabled={saveMutation.isPending || !keyInput.trim()}
          >
            {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Format a scan analysis result as a markdown chat message. */
function formatScanAnalysis(data: AiScanAnalysis): string {
  const sev = (s: string) =>
    s === 'critical' ? '🔴' : s === 'high' ? '🟠' : s === 'medium' ? '🟡' : '🔵';
  const lines: string[] = [
    `## Scan Analysis\n`,
    `**${data.overallAssessment}**\n`,
    data.summary,
    '',
  ];
  if (data.insights?.length) {
    lines.push('### Key Insights');
    data.insights.forEach((ins) =>
      lines.push(`- ${sev(ins.severity)} **${ins.title}** — ${ins.recommendation}`),
    );
    lines.push('');
  }
  lines.push(`**Top Priority:** ${data.topPriority}`);
  lines.push(`**Estimated Impact:** ${data.estimatedImpact}`);
  return lines.join('\n');
}

/** Format a code review result as a markdown chat message. */
function formatCodeReview(data: AiCodeReview): string {
  const verdictLabel =
    data.verdict === 'approved'
      ? '✅ Approved'
      : data.verdict === 'needs_changes'
        ? '⚠️ Needs Changes'
        : '🔴 Major Rework';
  const sev = (s: string) =>
    s === 'critical' ? '🔴' : s === 'high' ? '🟠' : s === 'medium' ? '🟡' : '🔵';
  const lines: string[] = [
    `## Code Review — ${data.overallScore}/10  ${verdictLabel}\n`,
    data.summary,
    '',
  ];
  if (data.strengths?.length) {
    lines.push('### Strengths');
    data.strengths.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }
  if (data.issues?.length) {
    lines.push('### Issues');
    data.issues.slice(0, 5).forEach((issue) =>
      lines.push(
        `- ${sev(issue.severity)} **${issue.title}** (${issue.type}${issue.file ? `, \`${issue.file}\`` : ''}) — ${issue.suggestion}`,
      ),
    );
    lines.push('');
  }
  if (data.securityConcerns?.length) {
    lines.push('### Security Concerns');
    data.securityConcerns.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }
  lines.push(`**Verdict:** ${data.verdict.replace('_', ' ')}`);
  return lines.join('\n');
}

const AI_ACTIONS = [
  { id: 'analyze', label: 'Analyze Scan', icon: Search, prompt: 'Analyze the latest scan results and suggest the top 3 improvements.' },
  { id: 'review', label: 'Code Review', icon: Code2, prompt: 'Review the codebase and identify the most critical quality issues.' },
  { id: 'tasks', label: 'Task Status', icon: Zap, prompt: 'Summarize the current task backlog and what I should focus on next.' },
  { id: 'workflow', label: 'Workflow Health', icon: GitMerge, prompt: 'How are my workflows progressing? Any blockers or risks?' },
];

export default function AiChat() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isLoaded, user } = useUser();

  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState('');
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  // PR-I: agentStage is now driven by real SSE stage events from the server
  // rather than a client-side timer that rotated through fake labels.
  const [agentStage, setAgentStage] = useState<string | null>(null);
  // Streaming: accumulates raw text deltas while Groq is streaming a response.
  // Cleared to '' once the `done` event arrives and the full message is added.
  const [streamingContent, setStreamingContent] = useState('');
  // STORY-04: actual model used at runtime — updated from every SSE done event
  // so the badge always reflects what the model that actually ran the request.
  const [lastResolvedModel, setLastResolvedModel] = useState<{ id: string; provider: string; free: boolean } | undefined>(undefined);
  const { send: streamSend, isPending: isSending } = useAiChatStream();

  // Live agent tool-step tracking — updated in real time via SSE callbacks.
  type AgentToolStep = { tool: string; args?: Record<string, string>; done: boolean; cached?: boolean; source?: string };
  const [agentSteps, setAgentSteps] = useState<AgentToolStep[]>([]);
  const [agentIter, setAgentIter] = useState<{ iter: number; max: number } | null>(null);

  // GAP-2: dedicated analyze / review mutations — call specialized endpoints
  // directly instead of routing through the free-form chat agent.
  const analyzeMutation = useAiAnalyzeProject({
    mutation: {
      onSuccess: (data: AiScanAnalysis) => {
        setAgentStage(null);
        setLocalMessages((prev) => [
          ...prev.filter((m) => m.id !== 'analyze-placeholder'),
          {
            id: `analyze-${Date.now()}`,
            role: 'assistant' as const,
            content: formatScanAnalysis(data),
            createdAt: new Date().toISOString(),
          },
        ]);
      },
      onError: (err: unknown) => {
        setAgentStage(null);
        setLocalMessages((prev) => prev.filter((m) => m.id !== 'analyze-placeholder'));
        toast({ title: 'Analysis failed', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  const reviewMutation = useAiReviewCode({
    mutation: {
      onSuccess: (data: AiCodeReview) => {
        setAgentStage(null);
        setLocalMessages((prev) => [
          ...prev.filter((m) => m.id !== 'review-placeholder'),
          {
            id: `review-${Date.now()}`,
            role: 'assistant' as const,
            content: formatCodeReview(data),
            createdAt: new Date().toISOString(),
          },
        ]);
      },
      onError: (err: unknown) => {
        setAgentStage(null);
        setLocalMessages((prev) => prev.filter((m) => m.id !== 'review-placeholder'));
        toast({ title: 'Code review failed', description: describeAiError(err), variant: 'destructive' });
      },
    },
  });

  const { data: activeProvider } = useQuery<ActiveProvider>({
    queryKey: ['active-provider'],
    queryFn: () => apiGet<ActiveProvider>('/api/ai/active-provider'),
    staleTime: 30_000,
  });

  // PR-06: poll runtime health metrics so provider cards show live state
  const { data: metricsData } = useQuery<MetricsResponse>({
    queryKey: ['ai-metrics'],
    queryFn: () => apiGet<MetricsResponse>('/api/ai/metrics'),
    staleTime: 15_000,
    refetchInterval: 30_000,
    enabled: isLoaded,
  });
  const metricsMap = new Map(
    (metricsData?.metrics ?? []).map((m) => [m.provider, m]),
  );

  // G-06 fix: pending changes are stored with a timestamp so stale entries
  // (from a crashed/closed tab after the server wrote the files but before
  // onSuccess could clear them) expire automatically after 24 hours instead
  // of becoming permanent phantom items.
  const PENDING_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  type StoredPending = { changes: PendingChange[]; savedAt: number };

  useEffect(() => {
    if (!sessionId) return;
    const key = `eos_pending_${sessionId}`;
    if (pendingChanges.length > 0) {
      const payload: StoredPending = { changes: pendingChanges, savedAt: Date.now() };
      localStorage.setItem(key, JSON.stringify(payload));
    } else {
      localStorage.removeItem(key);
    }
  }, [pendingChanges, sessionId]);

  useEffect(() => {
    if (!sessionId) { setPendingChanges([]); return; }
    const key = `eos_pending_${sessionId}`;
    const raw = localStorage.getItem(key);
    if (!raw) { setPendingChanges([]); return; }
    try {
      const stored = JSON.parse(raw) as StoredPending | PendingChange[];
      // Handle both the old format (plain array) and the new format ({ changes, savedAt }).
      const changes = Array.isArray(stored) ? stored : stored.changes;
      const savedAt  = Array.isArray(stored) ? 0       : stored.savedAt;
      if (Date.now() - savedAt > PENDING_TTL_MS) {
        // Entry is older than 24 h — the server almost certainly already wrote
        // those files.  Remove the ghost entry rather than confusing the user.
        localStorage.removeItem(key);
        setPendingChanges([]);
        return;
      }
      if (changes.length > 0) setPendingChanges(changes);
    } catch {
      localStorage.removeItem(key);
    }
  }, [sessionId]);

  // Use the generated hook (same URL and auth path as Projects.tsx) so this
  // query uses customFetch — which throws ApiError on non-2xx, preserving the
  // HTTP status through to the error classifier below.
  const {
    data: rawProjects,
    isLoading: projectsLoading,
    error: projectsError,
  } = useListProjects({
    query: {
      queryKey: getListProjectsQueryKey(),
      // Wait for Clerk to finish loading before the very first request so we
      // don't race the browser's own session cookie hydration.
      enabled: isLoaded,
      // Classify each failure to decide whether to retry automatically.
      // 401/403 are permanent — retrying just adds noise. 5xx / network errors
      // are transient and worth up to 2 automatic retries.
      retry: (failureCount, err) => isRetryableProjectError(err, failureCount),
    },
  });
  const projects = (rawProjects as Project[] | undefined) ?? [];

  // Derive a classified failure record once and reuse it in all three places
  // where error text is shown — status, kind, and message are all in one place.
  const projectLoadFailure = projectsError ? classifyProjectError(projectsError) : null;

  // Emit telemetry whenever a project-load failure is first observed.
  // TanStack Query v5 removed onError from query options; useEffect is the
  // correct place for side-effects on state changes.
  useEffect(() => {
    if (projectsError) emitProjectLoadFailed(projectsError, { userId: user?.id });
  }, [projectsError, user?.id]);

  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ['ai-sessions', selectedProjectId],
    queryFn: () => apiGet<Session[]>(`/api/ai/chat/sessions?projectId=${selectedProjectId}`),
    enabled: isLoaded && !!selectedProjectId,
  });

  const { data: serverMessages = [] } = useQuery<ChatMessage[]>({
    queryKey: ['ai-messages', sessionId],
    queryFn: () => apiGet<ChatMessage[]>(`/api/ai/chat/${sessionId}/messages`),
    enabled: isLoaded && !!sessionId,
  });

  useEffect(() => {
    if (serverMessages.length > 0) setLocalMessages(serverMessages);
  }, [serverMessages]);

  useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [localMessages]);

  /** Map server-side stage identifiers to user-facing labels. */
  const STAGE_LABELS: Record<string, string> = {
    'building-context': 'Building context…',
    'calling-model':    'Calling AI model…',
    'streaming':        'Writing response…',
  };

  /** Translate an AiStreamErrorEvent to a user-facing error description. */
  function describeStreamError(err: AiStreamErrorEvent): string {
    // Reuse describeAiError by constructing a temporary AiApiError from
    // the SSE error event's code → HTTP status mapping.
    const statusForCode: Record<string, number> = {
      RATE_LIMITED: 429,
      model_output_invalid: 422,
      AUTH_ERROR: 401,
      request_failed: 400,
    };
    const tmpErr = new AiApiError(
      statusForCode[err.code] ?? 502,
      err.message,
      err.hint,
      err.code,
    );
    return describeAiError(tmpErr);
  }

  const applyMutation = useMutation({
    mutationFn: (changes: PendingChange[]) =>
      apiPost<{ results: Array<{ path: string; ok: boolean; error?: string }> }>(
        '/api/ai/chat/apply-changes',
        { changes, projectId: selectedProjectId },
      ),
    onSuccess: (data) => {
      const failed    = data.results.filter((r) => !r.ok);
      const succeeded = data.results.filter((r) => r.ok);
      if (failed.length > 0) {
        toast({
          title: `${failed.length} file(s) failed to apply`,
          description: failed.map((f) => `${f.path}: ${f.error}`).join('\n'),
          variant: 'destructive',
        });
      }
      if (succeeded.length > 0) {
        toast({ title: `Applied ${succeeded.length} file change${succeeded.length !== 1 ? 's' : ''}` });
      }
      // Only remove changes that were successfully applied — keep failed ones visible so
      // the user knows which files still need attention.
      const succeededPaths = new Set(succeeded.map((r) => r.path));
      setPendingChanges((prev) => prev.filter((c) => !succeededPaths.has(c.path)));

      // G-05: refresh git-status in the GitPanel so it reflects the newly
      // written files (dirty markers, unstaged changes) without a manual reload.
      void qc.invalidateQueries({ queryKey: ['git-status', selectedProjectId] });
    },
    onError: (err) => {
      toast({ title: 'Failed to apply changes', description: describeAiError(err), variant: 'destructive' });
    },
  });

  /** Core send — accepts a pre-trimmed message string. Used by handleSend and
   *  handleQuickAction so both paths share the same streaming logic. */
  function sendMessage(msg: string) {
    if (!msg.trim()) return;
    if (!selectedProjectId) {
      toast({ title: 'No project selected', description: 'Select a project first to start chatting.', variant: 'destructive' });
      return;
    }
    if (isSending) return;
    setInput('');

    // Optimistic user message shown immediately while the stream runs.
    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      role: 'user',
      content: msg.trim(),
      createdAt: new Date().toISOString(),
    };
    setLocalMessages((prev) => [...prev, optimistic]);
    setAgentStage('Connecting…');
    setStreamingContent('');
    setAgentSteps([]);
    setAgentIter(null);

    void streamSend(
      { projectId: selectedProjectId, message: msg.trim(), sessionId },
      {
        onStage: (stage) => {
          setAgentStage(STAGE_LABELS[stage] ?? stage);
        },
        onDelta: (delta) => {
          setStreamingContent((prev) => prev + delta);
        },
        onStreamReset: () => {
          // GAP-A2: SSE stream broke mid-flight — clear the partial bubble so
          // the full fallback response in the subsequent `done` event is shown
          // cleanly without a flash of inconsistent partial content.
          setStreamingContent('');
        },
        onToolCall: (event) => {
          setAgentSteps((prev) => [...prev, { tool: event.tool, args: event.args, done: false, cached: event.cached }]);
        },
        onToolResult: (event) => {
          setAgentSteps((prev) => prev.map((s) =>
            s.tool === event.tool && !s.done
              ? { ...s, done: true, source: event.source, cached: event.cached }
              : s
          ));
        },
        onThinking: (event) => {
          setAgentIter({ iter: event.iter, max: event.max });
        },
        onDone: (data) => {
          setAgentStage(null);
          setStreamingContent('');
          setAgentSteps([]);
          setAgentIter(null);
          setSessionId(data.sessionId);
          setLocalMessages((prev) => {
            const withoutOpt = prev.filter((m) => !m.id.startsWith('opt-'));
            return [...withoutOpt, data.message as ChatMessage];
          });
          setPendingChanges(data.pendingChanges ?? []);
          // STORY-04: update displayed model from the done event
          if (data.resolvedModel) setLastResolvedModel(data.resolvedModel);
          void qc.invalidateQueries({ queryKey: ['ai-sessions', selectedProjectId] });
        },
        onError: (err) => {
          setAgentStage(null);
          setStreamingContent('');
          setAgentSteps([]);
          setAgentIter(null);
          setLocalMessages((prev) => prev.filter((m) => !m.id.startsWith('opt-')));
          toast({ title: 'Failed to send message', description: describeStreamError(err), variant: 'destructive' });
        },
      },
    );
  }

  function handleSend() {
    sendMessage(input.trim());
  }

  /** Quick-action dispatch:
   *  - 'analyze' → POST /api/ai/projects/:id/analyze (structured result rendered in chat)
   *  - 'review'  → POST /api/ai/projects/:id/review  (structured result rendered in chat)
   *  - others    → send the prompt directly through the chat agent
   */
  function handleQuickAction(action: typeof AI_ACTIONS[number]) {
    if (projectsLoading || !selectedProjectId) return;

    if (action.id === 'analyze') {
      if (analyzeMutation.isPending) return;
      setLocalMessages((prev) => [
        ...prev,
        { id: 'analyze-placeholder', role: 'user' as const, content: action.prompt, createdAt: new Date().toISOString() },
      ]);
      setAgentStage('Analyzing scan…');
      analyzeMutation.mutate({ projectId: selectedProjectId });
      return;
    }

    if (action.id === 'review') {
      if (reviewMutation.isPending) return;
      setLocalMessages((prev) => [
        ...prev,
        { id: 'review-placeholder', role: 'user' as const, content: action.prompt, createdAt: new Date().toISOString() },
      ]);
      setAgentStage('Reviewing code…');
      reviewMutation.mutate({ projectId: selectedProjectId });
      return;
    }

    // 'tasks' and 'workflow' — route through chat agent, send immediately.
    sendMessage(action.prompt);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function newSession() {
    setSessionId(undefined);
    setInput('');
    setLocalMessages([]);
    setPendingChanges([]);
  }

  // Derive the subtitle shown in the empty-chat state. Each case maps to a
  // specific root cause — no more "session may have expired" for 500 errors.
  function getStatusSubtitle(): string {
    if (!isLoaded || projectsLoading) return 'Loading your projects\u2026';
    if (projectLoadFailure) return projectLoadFailure.message;
    if (!selectedProjectId) return 'Create or select a project first to start chatting.';
    return 'Ask about your codebase, tasks, metrics, or workflows. I have full context.';
  }

  // Textarea placeholder follows the same classification.
  function getPlaceholder(): string {
    if (!isLoaded || projectsLoading) return 'Loading your projects\u2026';
    if (projectLoadFailure) return `${projectLoadFailure.message} Try refreshing\u2026`;
    if (!selectedProjectId) return 'Create a project first to start chatting\u2026';
    return 'Ask about your codebase, tasks, or metrics\u2026 (Enter to send)';
  }

  // Send-button title follows the same classification.
  function getSendTitle(): string | undefined {
    if (!isLoaded || projectsLoading) return 'Loading your projects\u2026';
    if (projectLoadFailure) return projectLoadFailure.message;
    if (!selectedProjectId) return 'Select a project first';
    return undefined;
  }

  const messages = localMessages;
  const isEmpty = messages.length === 0;

  // UI-01: sidebar collapse state — hidden by default on narrow screens.
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-full gap-0 relative">
      {/* UI-01: Mobile sidebar toggle button — only visible when sidebar is hidden */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="absolute top-3 left-2 z-20 flex items-center gap-1 px-2 py-1 rounded-md bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground transition-colors md:hidden"
          title="Open sessions"
        >
          <ChevronRight className="w-3.5 h-3.5" />
          Sessions
        </button>
      )}

      {/* Sidebar — sessions */}
      {/* UI-01: responsive width — hidden on mobile when collapsed, fixed w-56 on md+ */}
      <div
        className={`${sidebarOpen ? 'flex w-56' : 'hidden'} md:flex md:w-56 border-r border-border flex-col shrink-0 bg-background transition-all`}
      >
        <div className="p-3 border-b border-border flex items-center justify-between">
          <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Sessions</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={newSession}>
              <Plus className="w-3.5 h-3.5" />
            </Button>
            {/* Collapse button — only shown on narrow screens */}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 md:hidden"
              onClick={() => setSidebarOpen(false)}
              title="Close sidebar"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Project selector */}
        <div className="p-2 border-b border-border">
          <div className="relative">
            <select
              value={selectedProjectId}
              onChange={(e) => { setSelectedProjectId(e.target.value); newSession(); }}
              className="w-full text-xs bg-secondary border border-border rounded-md px-2 py-1.5 text-foreground appearance-none pr-6"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 absolute right-2 top-2 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 flex flex-col gap-1">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => { setSessionId(s.id); setLocalMessages([]); setPendingChanges([]); }}
                className={`text-left px-2 py-1.5 rounded text-xs truncate transition-colors ${
                  s.id === sessionId
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                {s.title}
              </button>
            ))}
          </div>
        </ScrollArea>

        {/* Provider key cards — bottom of sidebar (priority order: OpenRouter → Gemini → DeepSeek → Groq) */}
        <div className="border-t border-border pt-2">
          <OpenRouterKeyCard runtimeMetric={metricsMap.get('openrouter')} />
          <GeminiKeyCard    runtimeMetric={metricsMap.get('gemini')} />
          <DeepSeekKeyCard  runtimeMetric={metricsMap.get('deepseek')} />
          <GroqKeyCard      runtimeMetric={metricsMap.get('groq')} />
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-12 border-b border-border flex items-center px-4 gap-2 shrink-0">
          <Bot className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">EngineeringOS AI</span>
          <Badge variant="outline" className="text-xs font-mono ml-auto">
            {activeProvider?.provider === 'deepseek'
              ? 'DeepSeek V3'
              : activeProvider?.provider === 'openrouter'
                ? (lastResolvedModel
                    ? `${fmtModelId(lastResolvedModel.id)} · OpenRouter`
                    : 'OpenRouter')
                : activeProvider?.provider === 'gemini'
                  ? 'Gemini 2.5 Flash'
                  : 'Llama 3.3 · Groq'}
          </Badge>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 px-4 py-4">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-6">
              <div className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Bot className="w-6 h-6 text-primary" />
                </div>
                <p className="text-sm font-medium">How can I help with your project?</p>
                <p className={`text-xs text-center max-w-xs ${projectLoadFailure ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {getStatusSubtitle()}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
                {AI_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => handleQuickAction(action)}
                    disabled={!isLoaded || projectsLoading || !selectedProjectId || (action.id === 'analyze' && analyzeMutation.isPending) || (action.id === 'review' && reviewMutation.isPending)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-secondary hover:bg-secondary/80 text-xs text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-secondary"
                  >
                    <action.icon className="w-3.5 h-3.5 text-primary shrink-0" />
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
              {isSending && streamingContent ? (
                /* Streaming bubble — shows live token deltas as they arrive */
                <div className="flex gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                  <div className="bg-secondary border border-border rounded-xl rounded-tl-sm px-4 py-3 max-w-[75%] prose prose-sm prose-invert">
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
                        li: ({ children }) => <li className="mb-0.5">{children}</li>,
                        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                        code: ({ children }) => <code className="bg-black/20 rounded px-1 py-0.5 text-xs font-mono">{children}</code>,
                        pre: ({ children }) => <pre className="bg-black/20 rounded p-2 overflow-x-auto text-xs font-mono mb-2">{children}</pre>,
                        h1: ({ children }) => <h1 className="text-base font-bold mb-1">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-sm font-bold mb-1">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
                      }}
                    >
                      {streamingContent}
                    </ReactMarkdown>
                    {/* Blinking cursor to signal live streaming */}
                    <span className="inline-block w-0.5 h-3.5 bg-primary align-middle ml-0.5 animate-pulse" />
                  </div>
                </div>
              ) : isSending ? (
                /* Stage indicator — shown before first token arrives.
                   When the agent is using tools, shows a live scrolling list. */
                <div className="flex gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                  <div className="bg-secondary border border-border rounded-xl rounded-tl-sm px-4 py-3 flex flex-col gap-2 min-w-0 max-w-[75%]">
                    {agentSteps.length > 0 ? (
                      <>
                        {/* Tool-call list — last 6 steps, most recent at bottom */}
                        <div className="flex flex-col gap-1 text-xs font-mono">
                          {agentSteps.slice(-6).map((step, i) => {
                            const firstArg = step.args
                              ? Object.values(step.args)[0]
                              : undefined;
                            const label = firstArg
                              ? `${step.tool}(${String(firstArg).slice(0, 40)}${String(firstArg).length > 40 ? '…' : ''})`
                              : step.tool;
                            return (
                              <div key={i} className="flex items-center gap-1.5 leading-5">
                                {step.done ? (
                                  <span className="text-green-400 shrink-0">✓</span>
                                ) : (
                                  <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0" />
                                )}
                                <span className={step.done ? 'text-muted-foreground' : 'text-foreground'}>
                                  {label}
                                </span>
                                {step.cached && (
                                  <span className="text-[10px] text-muted-foreground/60">(cached)</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {/* Iter badge */}
                        {agentIter && (
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Activity className="w-3 h-3" />
                            Iteration {agentIter.iter + 1} / {agentIter.max}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                        <span className="text-xs text-muted-foreground transition-all duration-500">
                          {agentStage ?? 'Thinking…'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
              {pendingChanges.length > 0 && (
                <PendingChangesCard
                  changes={pendingChanges}
                  onApply={(changes) => applyMutation.mutate(changes)}
                  onReject={() => setPendingChanges([])}
                  isPending={applyMutation.isPending}
                />
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </ScrollArea>

        {/* Input */}
        <div className="p-4 border-t border-border shrink-0">
          <div className="max-w-3xl mx-auto flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={applyMutation.isPending ? 'Applying changes… please wait' : isSending ? 'Sending…' : getPlaceholder()}
              className="resize-none text-sm min-h-[44px] max-h-32 bg-secondary border-border"
              rows={1}
              disabled={!isLoaded || projectsLoading || !selectedProjectId || applyMutation.isPending || isSending}
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!isLoaded || projectsLoading || !input.trim() || !selectedProjectId || isSending || applyMutation.isPending}
              className="shrink-0 h-11 w-11"
              title={applyMutation.isPending ? 'Applying changes…' : isSending ? 'Sending…' : getSendTitle()}
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
