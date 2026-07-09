import React, { useState } from 'react';
import {
  useListRules,
  useCreateRule,
  getListRulesQueryKey,
  type Rule,
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
} from 'lucide-react';

type RuleSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export default function Rules() {
  const queryClient = useQueryClient();
  const { data: rules, isLoading } = useListRules({});
  const createRule = useCreateRule();

  const [showCreate, setShowCreate] = useState(false);
  const [newRule, setNewRule] = useState({
    title: '',
    code: '',
    description: '',
    pattern: '',
    fixDescription: '',
    severity: 'high' as RuleSeverity,
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createRule.mutate(
      { data: { ...newRule, verifySteps: [] } },
      {
        onSuccess: () => {
          setShowCreate(false);
          queryClient.invalidateQueries({ queryKey: getListRulesQueryKey() });
          setNewRule({
            title: '',
            code: '',
            description: '',
            pattern: '',
            fixDescription: '',
            severity: 'high',
          });
        },
      },
    );
  };

  const SeverityIcon = ({ severity }: { severity: string }) => {
    switch (severity) {
      case 'critical':
        return <AlertCircle className="w-4 h-4 text-destructive" />;
      case 'high':
        return <AlertTriangle className="w-4 h-4 text-orange-500" />;
      case 'medium':
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'low':
        return <Info className="w-4 h-4 text-blue-500" />;
      default:
        return <CheckCircle2 className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const severityColors: Record<string, string> = {
    critical: 'bg-destructive/10 text-destructive border-destructive/20',
    high: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    medium: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    low: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    info: 'bg-secondary text-muted-foreground border-border',
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
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filter rules..."
              className="bg-card border border-border rounded-md pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary w-64"
            />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> New Rule
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="bg-card border border-primary/30 rounded-xl p-5 shadow-md relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
          <h3 className="font-semibold mb-4 text-lg">Define New Rule</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Title
                </label>
                <input
                  required
                  value={newRule.title}
                  onChange={(e) => setNewRule({ ...newRule, title: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  placeholder="e.g. Prevent SQL Injection in raw queries"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Rule Code
                </label>
                <input
                  required
                  value={newRule.code}
                  onChange={(e) => setNewRule({ ...newRule, code: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
                  placeholder="SEC-001"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Pattern (Regex)
                </label>
                <input
                  value={newRule.pattern}
                  onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })}
                  className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
                  placeholder="e.g. execute\s*\(.*\$\{"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Severity
                </label>
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

      <div className="space-y-2">
        {isLoading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="h-20 bg-card border border-border rounded-xl animate-pulse" />
          ))
        ) : rules?.length === 0 ? (
          <div className="border-2 border-dashed border-border rounded-xl p-16 text-center flex flex-col items-center">
            <ShieldAlert className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-semibold mb-2">No rules defined</h3>
            <p className="text-muted-foreground text-sm max-w-sm mb-6">
              Create rules to detect patterns, enforce standards, and trigger automated fixes.
            </p>
          </div>
        ) : (
          rules?.map((rule) => (
            <div
              key={rule.id}
              className="bg-card border border-border rounded-xl p-4 flex items-start gap-4 hover:border-primary/30 transition-colors"
            >
              <SeverityIcon severity={rule.severity} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-mono text-xs bg-secondary px-2 py-0.5 rounded border border-border">
                    {rule.code}
                  </span>
                  <span className="font-semibold text-sm">{rule.title}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                      severityColors[rule.severity] || severityColors.info
                    }`}
                  >
                    {rule.severity}
                  </span>
                  {!rule.enabled && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-border text-muted-foreground">
                      DISABLED
                    </span>
                  )}
                </div>
                {rule.description && (
                  <p className="text-sm text-muted-foreground">{rule.description}</p>
                )}
                {rule.pattern && (
                  <div className="mt-2 font-mono text-xs bg-background border border-border rounded px-2 py-1 text-muted-foreground truncate">
                    {rule.pattern}
                  </div>
                )}
              </div>
              <div className="text-xs font-mono text-muted-foreground shrink-0 text-right">
                <div>{rule.hitCount ?? 0} hits</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
