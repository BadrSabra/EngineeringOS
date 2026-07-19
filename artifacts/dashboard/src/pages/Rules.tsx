import React, { useState, useMemo } from 'react';
import {
  useListRules,
  useCreateRule,
  getListRulesQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Search,
  ShieldAlert,
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  X,
  BarChart2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

type RuleSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export default function Rules() {
  const queryClient = useQueryClient();
  const [filterSeverity, setFilterSeverity] = useState<RuleSeverity | ''>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [newRule, setNewRule] = useState({
    title: '',
    code: '',
    description: '',
    pattern: '',
    fixDescription: '',
    severity: 'high' as RuleSeverity,
    verifySteps: [] as string[],
  });

  const { data: rules, isLoading } = useListRules(
    { severity: filterSeverity || undefined },
    {
      query: {
        queryKey: getListRulesQueryKey({ severity: filterSeverity || undefined }),
        staleTime: 30_000,
      },
    },
  );

  const createRule = useCreateRule();

  const visibleRules = useMemo(() => {
    if (!rules) return [];
    const term = searchTerm.toLowerCase();
    return rules
      .filter(
        (r) =>
          !term ||
          r.title.toLowerCase().includes(term) ||
          r.code.toLowerCase().includes(term) ||
          (r.description ?? '').toLowerCase().includes(term),
      )
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5));
  }, [rules, searchTerm]);

  // Summary stats
  const totalHits = rules?.reduce((sum, r) => sum + (r.hitCount ?? 0), 0) ?? 0;
  const enabledCount = rules?.filter((r) => r.enabled).length ?? 0;
  const criticalCount = rules?.filter((r) => r.severity === 'critical' || r.severity === 'high').length ?? 0;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createRule.mutate(
      { data: { ...newRule, verifySteps: newRule.verifySteps.map((s) => s.trim()).filter(Boolean) } },
      {
        onSuccess: () => {
          setShowCreate(false);
          queryClient.invalidateQueries({ queryKey: getListRulesQueryKey() });
          setNewRule({ title: '', code: '', description: '', pattern: '', fixDescription: '', severity: 'high', verifySteps: [] });
        },
      },
    );
  };

  const SeverityIcon = ({ severity }: { severity: string }) => {
    switch (severity) {
      case 'critical': return <AlertCircle className="w-4 h-4 text-destructive" />;
      case 'high':     return <AlertTriangle className="w-4 h-4 text-orange-500" />;
      case 'medium':   return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'low':      return <Info className="w-4 h-4 text-blue-500" />;
      default:         return <CheckCircle2 className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const severityColors: Record<string, string> = {
    critical: 'bg-destructive/10 text-destructive border-destructive/20',
    high:     'bg-orange-500/10 text-orange-500 border-orange-500/20',
    medium:   'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    low:      'bg-blue-500/10 text-blue-500 border-blue-500/20',
    info:     'bg-secondary text-muted-foreground border-border',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-primary" /> Rules Engine
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Define static patterns and AI-driven heuristics.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Severity filter */}
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value as RuleSeverity | '')}
            className="bg-card border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none"
          >
            <option value="">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="info">Info</option>
          </select>
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter rules..."
              className="bg-card border border-border rounded-md pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary w-56"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> New Rule
          </button>
        </div>
      </div>

      {/* Summary stat row */}
      {rules && rules.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xl font-bold font-mono">{enabledCount}</div>
              <div className="text-xs text-muted-foreground">Active rules</div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
              <AlertCircle className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xl font-bold font-mono">{criticalCount}</div>
              <div className="text-xs text-muted-foreground">Critical / High</div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
              <BarChart2 className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xl font-bold font-mono">{totalHits}</div>
              <div className="text-xs text-muted-foreground">Total violations</div>
            </div>
          </div>
        </div>
      )}

      {/* Active filter indicator */}
      {(searchTerm || filterSeverity) && rules && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Showing <strong className="text-foreground">{visibleRules.length}</strong> of {rules.length} rules</span>
          {(searchTerm || filterSeverity) && (
            <button
              onClick={() => { setSearchTerm(''); setFilterSeverity(''); }}
              className="text-primary hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="bg-card border border-primary/30 rounded-xl p-5 shadow-md relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-lg">Define New Rule</h3>
            <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Title</label>
                <input
                  required
                  value={newRule.title}
                  onChange={(e) => setNewRule({ ...newRule, title: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  placeholder="e.g. Prevent SQL Injection in raw queries"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Rule Code</label>
                <input
                  required
                  value={newRule.code}
                  onChange={(e) => setNewRule({ ...newRule, code: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
                  placeholder="SEC-001"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Description</label>
              <textarea
                value={newRule.description}
                onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
                rows={2}
                className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none resize-none"
                placeholder="What does this rule detect?"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pattern (Regex)</label>
                <input
                  value={newRule.pattern}
                  onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
                  placeholder={`e.g. execute\\s*\\(.*\\$\\{`}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Severity</label>
                <select
                  value={newRule.severity}
                  onChange={(e) => setNewRule({ ...newRule, severity: e.target.value as RuleSeverity })}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none"
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                  <option value="info">Info</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Verification Steps
                </label>
                <button
                  type="button"
                  onClick={() => setNewRule({ ...newRule, verifySteps: [...newRule.verifySteps, ''] })}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add step
                </button>
              </div>
              {newRule.verifySteps.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">None — optional shell commands run to verify the rule fix.</p>
              ) : (
                <div className="space-y-1.5">
                  {newRule.verifySteps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        value={step}
                        onChange={(e) =>
                          setNewRule({
                            ...newRule,
                            verifySteps: newRule.verifySteps.map((s, i) => (i === idx ? e.target.value : s)),
                          })
                        }
                        className="flex-1 bg-secondary border border-border rounded-md px-3 py-1.5 text-sm font-mono focus:border-primary focus:outline-none"
                        placeholder="e.g. pnpm run lint -- --rule no-eval"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setNewRule({
                            ...newRule,
                            verifySteps: newRule.verifySteps.filter((_, i) => i !== idx),
                          })
                        }
                        className="text-muted-foreground hover:text-destructive p-1"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={createRule.isPending}
                className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm disabled:opacity-50 transition-colors"
              >
                {createRule.isPending ? 'Creating…' : 'Create Rule'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-md font-medium text-sm border border-border hover:bg-secondary transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rule list */}
      <div className="space-y-2">
        {isLoading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="h-20 bg-card border border-border rounded-xl animate-pulse" />
          ))
        ) : visibleRules.length === 0 ? (
          <div className="border-2 border-dashed border-border rounded-xl p-16 text-center flex flex-col items-center">
            <ShieldAlert className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-semibold mb-2">
              {searchTerm || filterSeverity ? 'No rules match your filters' : 'No rules defined'}
            </h3>
            <p className="text-muted-foreground text-sm max-w-sm mb-6">
              {searchTerm || filterSeverity
                ? 'Try adjusting your search or severity filter.'
                : 'Create rules to detect patterns, enforce standards, and trigger automated fixes.'}
            </p>
            {!(searchTerm || filterSeverity) && (
              <button
                onClick={() => setShowCreate(true)}
                className="bg-primary text-primary-foreground px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Create First Rule
              </button>
            )}
          </div>
        ) : (
          visibleRules.map((rule) => (
            <div
              key={rule.id}
              className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/30 transition-colors"
            >
              <div
                className="p-4 flex items-start gap-4 cursor-pointer"
                onClick={() => setExpandedRule(expandedRule === rule.id ? null : rule.id)}
              >
                <SeverityIcon severity={rule.severity} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-mono text-xs bg-secondary px-2 py-0.5 rounded border border-border">
                      {rule.code}
                    </span>
                    <span className="font-semibold text-sm">{rule.title}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${severityColors[rule.severity] ?? severityColors.info}`}>
                      {rule.severity}
                    </span>
                    {!rule.enabled && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-border text-muted-foreground">
                        DISABLED
                      </span>
                    )}
                  </div>
                  {rule.description && (
                    <p className="text-sm text-muted-foreground line-clamp-1">{rule.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {(rule.hitCount ?? 0) > 0 && (
                    <span className="text-xs font-mono font-bold text-primary bg-primary/10 px-2 py-1 rounded">
                      {rule.hitCount} hits
                    </span>
                  )}
                  {expandedRule === rule.id ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              {expandedRule === rule.id && (
                <div className="border-t border-border bg-secondary/20 p-4 space-y-4 text-sm">
                  {rule.description && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Description</div>
                      <p className="text-sm">{rule.description}</p>
                    </div>
                  )}
                  {rule.pattern && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Detection Pattern</div>
                      <div className="bg-background border border-border rounded px-3 py-2 font-mono text-xs text-muted-foreground">
                        {rule.pattern}
                      </div>
                    </div>
                  )}
                  {rule.fixDescription && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Recommended Fix</div>
                      <p className="text-sm text-muted-foreground">{rule.fixDescription}</p>
                    </div>
                  )}
                  {rule.verifySteps && rule.verifySteps.length > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-2 uppercase tracking-wider font-semibold">Verification Steps</div>
                      <ol className="space-y-1 list-decimal list-inside">
                        {rule.verifySteps.map((step, i) => (
                          <li key={i} className="text-xs text-muted-foreground">{step}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground font-mono grid grid-cols-2 gap-2 pt-2 border-t border-border">
                    <div>Rule ID: {rule.id.slice(0, 12)}…</div>
                    <div>Hits recorded: {rule.hitCount ?? 0}</div>
                    {rule.projectId && <div>Scoped to project</div>}
                    <div>{rule.enabled ? '● Enabled' : '○ Disabled'}</div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
