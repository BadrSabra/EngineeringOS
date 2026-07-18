/**
 * GitPanel — GitHub integration panel for a project.
 *
 * Sections:
 *   1. Settings  — remote URL, branch, GitHub token
 *   2. Status    — modified / added / deleted files
 *   3. Commit    — message input + commit button
 *   4. Push      — push to remote button
 *   5. Log       — recent commits
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
} from 'lucide-react';

// ── API helpers ───────────────────────────────────────────────────────────────
// Use root-relative paths (/api/...) — same pattern as AiChat.tsx.
// Do NOT prefix with BASE_URL: that points to /dashboard/ and will 404.

async function apiFetch<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const resp = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    let parsed: { error?: string } = {};
    try { parsed = await resp.json() as typeof parsed; } catch { /* not JSON */ }
    throw new Error(parsed.error ?? `Request failed (${resp.status})`);
  }
  return resp.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface GitConfig { remoteUrl: string | null; branch: string }
interface StatusFile { status: string; path: string }
interface GitStatus { clean: boolean; files: StatusFile[] }
interface Commit { hash: string; shortHash: string; date: string; author: string; subject: string }
interface GitLog { commits: Commit[] }
interface TokenStatus { configured: boolean; last4?: string; updatedAt?: string }

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
  const label = key === '?' ? 'new' : key === 'M' ? 'mod' : key === 'A' ? 'add' : key === 'D' ? 'del' : key === 'R' ? 'ren' : key;
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border uppercase ${map[key] ?? map['?']}`}>
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
          This directory is not a git repository yet.
        </p>
        <p className="text-xs text-muted-foreground font-mono bg-secondary/60 rounded px-2 py-1 mt-0.5">
          git init &amp;&amp; git remote add origin &lt;url&gt;
        </p>
      </div>
    );
  }
  return <p className="text-xs text-destructive">{error.message}</p>;
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

  const configQ = useQuery<GitConfig>({
    queryKey: ['git-config', projectId],
    queryFn: () => apiFetch('GET', `/api/projects/${projectId}/git/config`),
    staleTime: 30_000,
  });

  const tokenQ = useQuery<TokenStatus>({
    queryKey: ['github-token'],
    queryFn: () => apiFetch('GET', '/api/ai/github-token'),
    staleTime: 60_000,
  });

  const statusQ = useQuery<GitStatus>({
    queryKey: ['git-status', projectId],
    queryFn: () => apiFetch('GET', `/api/projects/${projectId}/git/status`),
    refetchInterval: 15_000,
  });

  const logQ = useQuery<GitLog>({
    queryKey: ['git-log', projectId],
    queryFn: () => apiFetch('GET', `/api/projects/${projectId}/git/log`),
    enabled: showLog,
    staleTime: 30_000,
  });

  // ── Mutations ────────────────────────────────────────────────────────────────

  const saveConfig = useMutation({
    mutationFn: () =>
      apiFetch('PATCH', `/api/projects/${projectId}/git/config`, {
        remoteUrl: remoteInput.trim() || null,
        branch: branchInput.trim() || 'main',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['git-config', projectId] });
      setShowSettings(false);
    },
  });

  const saveToken = useMutation({
    mutationFn: () => apiFetch('PUT', '/api/ai/github-token', { token: tokenInput.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['github-token'] });
      setTokenInput('');
    },
  });

  const removeToken = useMutation({
    mutationFn: () => apiFetch('DELETE', '/api/ai/github-token'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['github-token'] }),
  });

  const commitMut = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; output: string }>('POST', `/api/projects/${projectId}/git/commit`, {
        message: commitMsg.trim(),
      }),
    onSuccess: () => {
      setCommitMsg('');
      qc.invalidateQueries({ queryKey: ['git-status', projectId] });
      qc.invalidateQueries({ queryKey: ['git-log', projectId] });
    },
  });

  const pushMut = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; branch: string; output: string }>('POST', `/api/projects/${projectId}/git/push`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['git-status', projectId] });
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
  const isConfigured = !!config?.remoteUrl && token?.configured;

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 className="font-semibold flex items-center gap-2 text-sm">
          <Github className="w-4 h-4 text-primary" />
          GitHub Integration
        </h2>
        <button
          onClick={openSettings}
          className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title="Configure"
        >
          <Settings2 className="w-3.5 h-3.5" />
        </button>
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
            {isConfigured ? 'Ready' : 'Not configured'}
          </span>

          {config?.remoteUrl && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground font-mono truncate max-w-[240px]">
              <Github className="w-3 h-3 shrink-0" />
              {config.remoteUrl.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')}
            </span>
          )}

          {config?.branch && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
              <GitBranch className="w-3 h-3" />
              {config.branch}
            </span>
          )}

          {token?.configured && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Key className="w-3 h-3" />
              token ···{token.last4}
            </span>
          )}
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div className="bg-secondary/40 border border-border rounded-lg p-4 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Settings</h3>

            {/* Remote URL */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Remote URL</label>
              <input
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="https://github.com/owner/repo.git"
                value={remoteInput}
                onChange={(e) => setRemoteInput(e.target.value)}
              />
            </div>

            {/* Branch */}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Branch</label>
              <input
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="main"
                value={branchInput}
                onChange={(e) => setBranchInput(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => saveConfig.mutate()}
                disabled={saveConfig.isPending}
                className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs px-3 py-1.5 rounded-md font-medium disabled:opacity-60 flex items-center gap-1.5"
              >
                {saveConfig.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                Save
              </button>
              <button
                onClick={() => setShowSettings(false)}
                className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-secondary text-muted-foreground"
              >
                Cancel
              </button>
            </div>

            {saveConfig.isError && (
              <p className="text-xs text-destructive">{(saveConfig.error as Error).message}</p>
            )}

            {/* GitHub token */}
            <div className="border-t border-border pt-4 space-y-2">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <Key className="w-3 h-3" /> GitHub Personal Access Token
              </label>
              {token?.configured ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono">Saved ···{token.last4}</span>
                  <button
                    onClick={() => removeToken.mutate()}
                    disabled={removeToken.isPending}
                    className="text-xs text-destructive hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="password"
                    className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="ghp_..."
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                  />
                  <button
                    onClick={() => saveToken.mutate()}
                    disabled={saveToken.isPending || !tokenInput.trim()}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs px-3 py-1.5 rounded-md font-medium disabled:opacity-60"
                  >
                    Save
                  </button>
                </div>
              )}
              {saveToken.isError && (
                <p className="text-xs text-destructive">{(saveToken.error as Error).message}</p>
              )}
            </div>
          </div>
        )}

        {/* Working tree status */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Working Tree
            </span>
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ['git-status', projectId] })}
              className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-3 h-3 ${statusQ.isFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {statusQ.isLoading ? (
            <div className="text-xs text-muted-foreground animate-pulse">Loading status…</div>
          ) : statusQ.isError ? (
            <NotAGitRepo error={statusQ.error as Error} />
          ) : status?.clean ? (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Check className="w-3 h-3 text-emerald-500" /> Nothing to commit
            </div>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {changedFiles.map((f) => (
                <div key={f.path} className="flex items-center gap-2 text-xs font-mono">
                  <FileBadge status={f.status} />
                  <span className="truncate text-foreground/80">{f.path}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Commit */}
        {!status?.clean && (
          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Commit
            </span>
            <textarea
              rows={2}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              placeholder="Commit message…"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
            />
            <button
              onClick={() => commitMut.mutate()}
              disabled={commitMut.isPending || !commitMsg.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs px-3 py-1.5 rounded-md font-medium disabled:opacity-60 flex items-center gap-1.5 w-full justify-center"
            >
              {commitMut.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <GitCommit className="w-3 h-3" />
              )}
              Commit all changes
            </button>
            {commitMut.isError && (
              <p className="text-xs text-destructive">{(commitMut.error as Error).message}</p>
            )}
            {commitMut.isSuccess && (
              <p className="text-xs text-emerald-500 font-mono">{(commitMut.data as { output: string }).output}</p>
            )}
          </div>
        )}

        {/* Push */}
        <div>
          <button
            onClick={() => pushMut.mutate()}
            disabled={pushMut.isPending || !isConfigured}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-secondary text-foreground disabled:opacity-50 disabled:cursor-not-allowed w-full justify-center font-medium transition-colors"
            title={!isConfigured ? 'Configure remote URL and GitHub token first' : ''}
          >
            {pushMut.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Upload className="w-3 h-3" />
            )}
            Push to {config?.branch ?? 'main'}
          </button>
          {pushMut.isError && (
            <p className="text-xs text-destructive mt-1">{(pushMut.error as Error).message}</p>
          )}
          {pushMut.isSuccess && (
            <p className="text-xs text-emerald-500 font-mono mt-1">
              ✓ Pushed to {(pushMut.data as { branch: string }).branch}
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
            Commit history
          </button>

          {showLog && (
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {logQ.isLoading ? (
                <div className="text-xs text-muted-foreground animate-pulse">Loading log…</div>
              ) : logQ.isError ? (
                <div className="text-xs text-destructive">{(logQ.error as Error).message}</div>
              ) : !logQ.data?.commits.length ? (
                <div className="text-xs text-muted-foreground">No commits yet.</div>
              ) : (
                logQ.data.commits.map((c) => (
                  <div key={c.hash} className="flex items-start gap-2 text-xs">
                    <span className="font-mono text-primary shrink-0">{c.shortHash}</span>
                    <span className="text-muted-foreground shrink-0">{c.date}</span>
                    <span className="truncate">{c.subject}</span>
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
