/**
 * GitPanel — GitHub integration panel for a project.
 *
 * Sections:
 *   1. Settings  — remote URL, branch, optional legacy token
 *   2. Status    — modified / added / deleted files
 *   3. Commit    — message input + commit button
 *   4. Push      — push to remote button
 *   5. Log       — recent commits
 */
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Github,
  GitBranch,
  GitCommit,
  Upload,
  RefreshCw,
  Check,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Key,
  Settings2,
  Loader2,
  Download,
} from 'lucide-react';
import {
  useGetGitConfig,
  useGetGitHubTokenStatus,
  useGetGitStatus,
  useGetGitLog,
  useUpdateGitConfig,
  useSaveGitHubToken,
  useDeleteGitHubToken,
  useGitCommit,
  useGitPush,
} from '@workspace/api-client-react';

// ── Status badge ──────────────────────────────────────────────────────────────

function FileBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    M: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30',
    A: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
    D: 'bg-destructive/10 text-destructive border-destructive/30',
    '?': 'bg-muted text-muted-foreground border-border',
    R: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
  };
  const key = status[0] ?? '?';
  const label = key === '?' ? 'جديد' : key === 'M' ? 'تعديل' : key === 'A' ? 'إضافة' : key === 'D' ? 'حذف' : key === 'R' ? 'نقل' : key;
  return (
    <span dir="rtl" title={label} aria-label={`حالة الملف: ${label}`} className={`text-[10px] font-mono px-1.5 py-0.5 rounded border uppercase ${map[key] ?? map['?']}`}>
      {label}
    </span>
  );
}

// ── Not-a-git-repo empty state ────────────────────────────────────────────────

function NotAGitRepo({ error }: { error: Error }) {
  const isNotRepo = error.message.includes("not_a_git_repo") || error.message.includes("not a git repository");
  if (isNotRepo) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">
          مجلد المشروع غير مهيّأ كمستودع Git بعد.
        </p>
        <p className="text-xs text-muted-foreground font-mono bg-secondary/60 rounded px-2 py-1 mt-0.5">
          <bdi dir="ltr">git init &amp;&amp; git remote add origin &lt;url&gt;</bdi>
        </p>
      </div>
    );
  }
  return <p dir="auto" className="text-xs text-destructive">{error.message}</p>;
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props { projectId: string }

export default function GitPanel({ projectId }: Props) {
  const qc = useQueryClient();
  const [showSettings, setShowSettings] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');

  // Settings form state
  const [remoteInput, setRemoteInput] = useState('');
  const [branchInput, setBranchInput] = useState('main');
  const [tokenInput, setTokenInput] = useState('');

  // ── Queries ─────────────────────────────────────────────────────────────────

  const configQ = useGetGitConfig(projectId, {
    query: {
      staleTime: 30_000,
      queryKey: ['git-config', projectId],
    },
  });

  const tokenQ = useGetGitHubTokenStatus({
    query: {
      staleTime: 60_000,
      queryKey: ['github-token'],
    },
  });

  const statusQ = useGetGitStatus(projectId, {
    query: {
      queryKey: ['git-status', projectId],
      // Stop polling if the directory is not a git repo (400) — retrying every
      // 15 s would just flood the server with known-bad requests.
      refetchInterval: (query) => (query.state.status === 'error' ? false : 15_000),
      retry: false,
    },
  });

  const logQ = useGetGitLog(projectId, {
    query: {
      queryKey: ['git-log', projectId],
      enabled: showLog,
      staleTime: 30_000,
    },
  });

  // ── Mutations ────────────────────────────────────────────────────────────────

  const saveConfig = useUpdateGitConfig({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['git-config', projectId] });
        setShowSettings(false);
      },
    },
  });

  const saveToken = useSaveGitHubToken({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['github-token'] });
        setTokenInput('');
      },
    },
  });

  const removeToken = useDeleteGitHubToken({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: ['github-token'] }),
    },
  });

  const commitMut = useGitCommit({
    mutation: {
      onSuccess: () => {
        setCommitMsg('');
        qc.invalidateQueries({ queryKey: ['git-status', projectId] });
        qc.invalidateQueries({ queryKey: ['git-log', projectId] });
      },
    },
  });

  const pushMut = useGitPush({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['git-status', projectId] });
      },
    },
  });

  // ── Open settings with current values pre-filled ───────────────────────────

  const openSettings = () => {
    setRemoteInput(configQ.data?.remoteUrl ?? '');
    setBranchInput(configQ.data?.branch ?? 'main');
    setShowSettings(true);
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const config = configQ.data;
  const token = tokenQ.data;
  const status = statusQ.data;
  const changedFiles = status?.files ?? [];
  const isGitHubRemote = /^https:\/\/github\.com\//i.test(config?.remoteUrl ?? '');
  const isConfigured = !!config?.remoteUrl && (isGitHubRemote || Boolean(token?.configured));

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden" dir="rtl" aria-label="ربط GitHub">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 className="font-semibold flex items-center gap-2 text-sm">
          <Github className="w-4 h-4 text-primary" />
          ربط GitHub
        </h2>
        <div className="flex items-center gap-1">
          <a
            href={`/api/projects/${projectId}/export`}
            download
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="تنزيل نسخة من ملفات المشروع بصيغة tar.gz"
            aria-label="تنزيل نسخة من ملفات المشروع"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
          <button
            onClick={openSettings}
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="إعداد الربط"
            aria-label="إعداد الربط"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-5 space-y-5">

        {/* Config summary */}
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-mono ${
              isConfigured
                ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                : 'bg-muted text-muted-foreground border-border'
            }`}
          >
            {isConfigured ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {isConfigured ? 'الإعداد مكتمل' : 'غير مُهيّأ'}
          </span>

          {config?.remoteUrl && (
            <span dir="ltr" className="flex items-center gap-1 text-xs text-muted-foreground font-mono truncate max-w-[240px]">
              <Github className="w-3 h-3 shrink-0" />
              {config.remoteUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')}
            </span>
          )}

          {config?.branch && (
            <span dir="ltr" className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
              <GitBranch className="w-3 h-3" />
              {config.branch}
            </span>
          )}

          {token?.configured && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Key className="w-3 h-3" />
              رمز محفوظ ···<bdi dir="ltr">{token.last4}</bdi>
            </span>
          )}
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div className="bg-secondary/40 border border-border rounded-lg p-4 space-y-4">
            <h3 className="text-xs font-semibold text-muted-foreground">إعدادات الربط</h3>

            {/* Remote URL */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">عنوان المستودع البعيد</label>
              <input
                dir="ltr"
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="https://github.com/owner/repo.git"
                value={remoteInput}
                onChange={(e) => setRemoteInput(e.target.value)}
              />
              {remoteInput.trim() && !remoteInput.trim().match(/^https?:\/\//) && (
                <p className="text-xs text-yellow-500 flex items-center gap-1 mt-1">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  روابط <bdi dir="ltr">SSH</bdi> غير مدعومة؛ الإرسال إلى المستودع يتطلب رابط <bdi dir="ltr">HTTPS</bdi>.
                </p>
              )}
            </div>

            {/* Branch */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">اسم الفرع</label>
              <input
                dir="ltr"
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="main"
                value={branchInput}
                onChange={(e) => setBranchInput(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() =>
                  saveConfig.mutate({
                    projectId,
                    data: {
                      remoteUrl: remoteInput.trim(),
                      branch: branchInput.trim() || 'main',
                    },
                  })
                }
                disabled={saveConfig.isPending}
                className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs px-3 py-1.5 rounded-md font-medium disabled:opacity-60 flex items-center gap-1.5"
              >
                {saveConfig.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                حفظ الإعدادات
              </button>
              <button
                onClick={() => setShowSettings(false)}
                className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-secondary text-muted-foreground"
              >
                إلغاء
              </button>
            </div>

            {saveConfig.isError && (
              <p dir="auto" className="text-xs text-destructive">{(saveConfig.error as Error).message}</p>
            )}

            {/* Legacy token fallback for non-GitHub HTTPS remotes */}
            <div className="border-t border-border pt-4 space-y-2">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <Key className="w-3 h-3" /> رمز اتصال HTTPS بديل
              </label>
              <p className="text-[11px] text-muted-foreground">
                يستخدم المستودع على <bdi dir="ltr">github.com</bdi> ربط GitHub تلقائيًا. لا يُستخدم هذا الرمز إلا مع مستودعات HTTPS الأخرى.
              </p>
              {token?.configured ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono">محفوظ ···<bdi dir="ltr">{token.last4}</bdi></span>
                  <button
                    onClick={() => removeToken.mutate()}
                    disabled={removeToken.isPending}
                    className="text-xs text-destructive hover:underline"
                  >
                    حذف الرمز
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="password"
                    className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                    dir="ltr"
                    placeholder="ghp_..."
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                  />
                  <button
                    onClick={() => saveToken.mutate({ data: { token: tokenInput.trim() } })}
                    disabled={saveToken.isPending || !tokenInput.trim()}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs px-3 py-1.5 rounded-md font-medium disabled:opacity-60"
                  >
                    حفظ الرمز
                  </button>
                </div>
              )}
              {saveToken.isError && (
                <p dir="auto" className="text-xs text-destructive">{(saveToken.error as Error).message}</p>
              )}
            </div>
          </div>
        )}

        {/* Working tree status */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              حالة ملفات المشروع
            </span>
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ['git-status', projectId] })}
              className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="تحديث حالة الملفات"
              aria-label="تحديث حالة الملفات"
            >
              <RefreshCw className={`w-3 h-3 ${statusQ.isFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {statusQ.isLoading ? (
            <div className="text-xs text-muted-foreground animate-pulse">جارٍ تحميل حالة الملفات…</div>
          ) : statusQ.isError ? (
            <NotAGitRepo error={statusQ.error as Error} />
          ) : status?.clean ? (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Check className="w-3 h-3 text-emerald-500" /> لا توجد تغييرات جديدة لتسجيلها في Git
            </div>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {changedFiles.map((f) => (
                <div key={f.path} dir="ltr" className="flex items-center gap-2 text-xs font-mono">
                  <FileBadge status={f.status} />
                  <span className="truncate text-foreground/80">{f.path}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Commit */}
        {statusQ.isSuccess && !status?.clean && (
          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              تسجيل التغييرات (Commit)
            </span>
            <p className="text-[11px] leading-relaxed text-amber-200">
              سيسجّل هذا الإجراء جميع التغييرات الحالية في مجلد المشروع، وليس الملفات المعروضة هنا فقط. لا يرسلها إلى GitHub.
            </p>
            <textarea
              dir="auto"
              rows={2}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              placeholder="اكتب وصفًا موجزًا للتغييرات…"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
            />
            <button
              onClick={() => commitMut.mutate({ projectId, data: { message: commitMsg.trim() } })}
              disabled={commitMut.isPending || !commitMsg.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs px-3 py-1.5 rounded-md font-medium disabled:opacity-60 flex items-center gap-1.5 w-full justify-center"
            >
              {commitMut.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <GitCommit className="w-3 h-3" />
              )}
              تسجيل كل التغييرات
            </button>
            {commitMut.isError && (
              <p dir="auto" className="text-xs text-destructive">{(commitMut.error as Error).message}</p>
            )}
            {commitMut.isSuccess && (
              <p dir="ltr" className="text-xs text-emerald-500 font-mono">{(commitMut.data as { output: string }).output}</p>
            )}
          </div>
        )}

        {/* Push */}
        <div>
          <button
            onClick={() => pushMut.mutate({ projectId })}
            disabled={pushMut.isPending || !isConfigured}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-secondary text-foreground disabled:opacity-50 disabled:cursor-not-allowed w-full justify-center font-medium transition-colors"
              title={!isConfigured ? 'أعدّ مستودع GitHub بعنوان HTTPS أولًا' : ''}
          >
            {pushMut.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Upload className="w-3 h-3" />
            )}
            إرسال التغييرات إلى الفرع <bdi dir="ltr">{config?.branch ?? 'main'}</bdi>
          </button>
          {pushMut.isError && (
            <p dir="auto" className="text-xs text-destructive mt-1">{(pushMut.error as Error).message}</p>
          )}
          {pushMut.isSuccess && (
            <p className="text-xs text-emerald-500 font-mono mt-1">
              ✓ تم إرسال التغييرات إلى الفرع <bdi dir="ltr">{(pushMut.data as { branch: string }).branch}</bdi>
            </p>
          )}
        </div>

        {/* Commit log (collapsible) */}
        <div>
          <button
            onClick={() => setShowLog((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showLog ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            سجل تغييرات Git
          </button>

          {showLog && (
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {logQ.isLoading ? (
                <div className="text-xs text-muted-foreground animate-pulse">جارٍ تحميل السجل…</div>
              ) : logQ.isError ? (
                <div dir="auto" className="text-xs text-destructive">{(logQ.error as Error).message}</div>
              ) : !logQ.data?.commits.length ? (
                <div className="text-xs text-muted-foreground">لا توجد تغييرات مسجّلة بعد.</div>
              ) : (
                logQ.data.commits.map((c) => (
                  <div key={c.hash} dir="ltr" className="flex items-start gap-2 text-xs">
                    <span className="font-mono text-primary shrink-0">{c.shortHash}</span>
                    <span className="text-muted-foreground shrink-0">{c.date}</span>
                    <span dir="auto" className="truncate">{c.subject}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
