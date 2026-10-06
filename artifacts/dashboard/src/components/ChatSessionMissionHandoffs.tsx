import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Loader2, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';
import type { AiChatSessionMissionsResponse } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { fetchMissionProjection, type MissionProjection } from '@/lib/ai-missions';

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
  if (status === 'blocked' || status === 'failed' || status === 'needs_replan') {
    return 'border-destructive/30 bg-destructive/10 text-destructive';
  }
  if (status === 'waiting' || status === 'waiting_for_event' || status === 'waiting_for_approval') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  }
  return 'border-primary/30 bg-primary/10 text-primary';
}

function MissionProjectionDetails({
  projectId,
  sessionId,
  userId,
  mission,
}: {
  projectId: string;
  sessionId: string;
  userId: string | null;
  mission: SessionMission;
}) {
  const [expanded, setExpanded] = useState(false);
  const handoffSessionId = mission.agentControl.handoff.sessionId;
  const query = useQuery({
    queryKey: ['chat-mission-projection', userId, projectId, sessionId, mission.mission.id],
    queryFn: ({ signal }) => fetchMissionProjection(mission.mission.id, signal),
    enabled: expanded && Boolean(userId) && handoffSessionId === sessionId,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: (currentQuery) => {
      const projection = currentQuery.state.data as MissionProjection | undefined;
      return projection?.mission.status === 'active' ? 15_000 : false;
    },
    refetchIntervalInBackground: false,
  });
  const projection = query.data;
  const projectionMatchesMission = Boolean(
    projection
      && projection.mission.id === mission.mission.id
      && projection.mission.projectId === projectId,
  );
  const currentPlanGoalIds = new Set(
    Array.isArray(projection?.currentPlan?.goalIds) ? projection.currentPlan.goalIds : [],
  );
  const currentGoals = (projection?.goals ?? []).filter(({ goal }) => currentPlanGoalIds.has(goal.id));
  const detailsId = `chat-mission-projection-${mission.mission.id}`;

  return (
    <div className="mt-3 border-t border-border/50 pt-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        className="rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid={`button-chat-mission-projection-${mission.mission.id}`}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? 'Hide plan and attempts' : 'View current plan and attempts'}
      </button>

      {expanded && (
        <div
          id={detailsId}
          className="mt-3 space-y-3"
          data-testid={`chat-mission-projection-${mission.mission.id}`}
          role="region"
          aria-label={`Current plan and attempts for ${mission.mission.title}`}
        >
          {handoffSessionId !== sessionId && (
            <p className="text-xs text-destructive" role="alert">
              This Mission link does not match the current Chat session. Its operational details were not loaded.
            </p>
          )}

          {!userId && (
            <p className="text-xs text-muted-foreground" role="status">
              Mission details are unavailable until the signed-in user is ready.
            </p>
          )}

          {query.isPending && userId && handoffSessionId === sessionId && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Loading the current Mission plan and attempts…
            </p>
          )}

          {query.isError && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <span role="alert">
                {projection
                  ? 'The latest Mission details could not be refreshed; the displayed projection may be outdated.'
                  : 'The current Mission plan could not be loaded.'}
              </span>
              <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => void query.refetch()}>
                <RotateCcw className="mr-1.5 h-3 w-3" />
                Retry
              </Button>
            </div>
          )}

          {query.isFetching && !query.isPending && !query.isError && (
            <p className="text-[11px] text-muted-foreground" role="status">Refreshing Mission details…</p>
          )}

          {projection && !projectionMatchesMission && (
            <p className="text-xs text-destructive" role="alert">
              The returned Mission projection does not match this linked Mission and project. Details were withheld.
            </p>
          )}

          {projection && projectionMatchesMission && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Current Mission status</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${missionStatusClass(projection.mission.status)}`}>
                  {missionStatusLabel(projection.mission.status)}
                </span>
                {projection.currentPlan.revision && (
                  <span className="min-w-0 text-muted-foreground">
                    Plan revision <code className="break-all text-foreground/80">{projection.currentPlan.revision}</code>
                  </span>
                )}
              </div>

              {projection.currentPlan.binding === 'revision_mismatch' ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200" role="alert">
                  The Mission records an active plan revision, but no Goal is bound to it. Older Goals are not shown as current.
                </p>
              ) : projection.currentPlan.binding === 'legacy_unversioned' ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  This legacy Mission has no recorded active plan revision; listed Goals are unversioned.
                </p>
              ) : null}

              {currentGoals.length === 0 ? (
                <p className="text-xs text-muted-foreground">No Goals are currently recorded for this plan.</p>
              ) : (
                <ul className="grid gap-2 md:grid-cols-2" aria-label="Current plan Goals">
                  {currentGoals.map(({ goal, currentAttempt }) => (
                    <li
                      key={goal.id}
                      className="min-w-0 rounded-lg border border-border/60 bg-background/70 p-3"
                      data-testid={`chat-mission-current-goal-${goal.id}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="break-words text-xs font-medium text-foreground">{goal.title}</p>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${missionStatusClass(goal.status)}`}>
                          {missionStatusLabel(goal.status)}
                        </span>
                      </div>
                      {goal.description && (
                        <p className="mt-1 break-words text-[11px] text-muted-foreground">{goal.description}</p>
                      )}
                      <p className="mt-2 text-[11px] text-muted-foreground" data-testid={`chat-mission-current-attempt-${goal.id}`}>
                        {currentAttempt
                          ? `Latest attempt ${currentAttempt.attempt} · ${missionStatusLabel(currentAttempt.status)}`
                          : 'No execution attempt recorded'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatSessionMissionHandoffs({
  projectId,
  sessionId,
  userId,
  missions,
  isPending,
  isError,
  onRetry,
}: {
  projectId: string;
  sessionId: string;
  userId: string | null;
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
          {missions.map(({ mission, agentControl }) => (
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
              <MissionProjectionDetails
                projectId={projectId}
                sessionId={sessionId}
                userId={userId}
                mission={{ mission, agentControl }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
