import { ArrowUpRight, Loader2, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import type { AiChatSessionMissionsResponse } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';

type SessionMission = AiChatSessionMissionsResponse['missions'][number];

function missionStatusLabel(status: string) {
  return status
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function missionStatusClass(status: string) {
  if (status === 'completed') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  }
  if (status === 'blocked' || status === 'failed') {
    return 'border-destructive/30 bg-destructive/10 text-destructive';
  }
  return 'border-primary/30 bg-primary/10 text-primary';
}

export function ChatSessionMissionHandoffs({
  projectId,
  missions,
  isPending,
  isError,
  onRetry,
}: {
  projectId: string;
  missions: SessionMission[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (missions.length === 0 && !isError && !isPending) return null;

  return (
    <section
      aria-labelledby="chat-session-missions-heading"
      className="mb-5 rounded-xl border border-primary/20 bg-primary/[0.04] p-4"
      data-testid="chat-session-missions"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="chat-session-missions-heading" className="text-sm font-semibold text-foreground">
            Missions linked to this chat
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Each Mission stays connected to this conversation.
          </p>
        </div>
        {(missions.length > 0 || !isPending) && (
          <span className="rounded-full border border-border/70 bg-background/60 px-2 py-0.5 text-xs text-muted-foreground">
            {missions.length} {missions.length === 1 ? 'Mission' : 'Missions'}
          </span>
        )}
      </div>

      {isPending && missions.length === 0 && !isError && (
        <p
          className="flex items-center gap-2 text-xs text-muted-foreground"
          data-testid="chat-session-missions-loading"
          role="status"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Loading linked Missions…
        </p>
      )}

      {isError && (
        <div
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          <span>
            {missions.length > 0
              ? 'The linked Mission list could not be refreshed.'
              : 'Linked Missions could not be loaded.'}
          </span>
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={onRetry}>
            <RotateCcw className="mr-1.5 h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      {missions.length > 0 && (
        <ul className="grid gap-2 md:grid-cols-2">
          {missions.map(({ mission }) => (
            <li
              key={mission.id}
              className="min-w-0 rounded-lg border border-border/60 bg-background/70 p-3"
              data-testid={`chat-session-mission-${mission.id}`}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-foreground">{mission.title}</p>
                  <span
                    className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${missionStatusClass(mission.status)}`}
                  >
                    {missionStatusLabel(mission.status)}
                  </span>
                </div>
                <Link
                  href={`/missions?projectId=${encodeURIComponent(projectId)}&missionId=${encodeURIComponent(mission.id)}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`link-chat-session-mission-${mission.id}`}
                >
                  Open Mission
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
