import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CapabilityGap } from '@workspace/api-client-react';

export function CapabilityGapNotice({ gap, projectId }: { gap: CapabilityGap; projectId: string }) {
  const [pending, setPending] = useState(false);
  const runRecipe = async () => {
    if (!gap.suggestedRecipeId) return;
    setPending(true);
    try {
      await fetch(`/api/ai/projects/${projectId}/recipe`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ recipeId: gap.suggestedRecipeId, recipeVersion: 1, approvedPaths: [] }),
      });
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-100" role="alert">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
      <div className="min-w-0 flex-1"><div className="font-semibold">{gap.code}</div><div className="mt-0.5 text-amber-100/80">{gap.summary}</div></div>
      {gap.suggestedRecipeId && <Button size="sm" variant="outline" onClick={runRecipe} disabled={pending}>{pending ? 'Starting…' : 'Run recipe'}</Button>}
    </div>
  );
}