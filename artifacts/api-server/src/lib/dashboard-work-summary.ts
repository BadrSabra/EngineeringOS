import {
  aiExecutionsTable as executions,
  aiGoalsTable as goals,
  aiMissionsTable as missions,
  projectsTable as projects,
  tasksTable as tasks,
  db,
} from "@workspace/db";
import { and, desc, eq, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { DashboardWorkSummary, DashboardWorkSummaryItem } from "@workspace/api-client-react";
import { projectMissionActivePlan } from "./mission-completion-gate.js";
import { redactUserFacingText } from "./ai-route-helpers.js";

export const WORK_SECTION_LIMIT = 8;
export const WORK_SOURCE_LIMIT = WORK_SECTION_LIMIT + 1;
const GOAL_LIMIT = 600;
type Group = "decisions" | "active" | "recent";
const GROUPS: Group[] = ["decisions", "active", "recent"];

// Mirrors projectMissionActivePlan's revision membership, including legacy
// unversioned records. It is only for inventory/dedup, never acceptance.
function currentGoal(g = "g", m = "m"): SQL {
  const revision = sql.raw(`NULLIF(CASE WHEN jsonb_typeof(${m}.autonomy_policy->'activePlanRevision') = 'string' THEN ${m}.autonomy_policy->>'activePlanRevision' END, '')`);
  const hash = (field: string) => sql.raw(`CASE WHEN jsonb_typeof(${g}.${field}->'planRevision'->'hash') = 'string' THEN ${g}.${field}->'planRevision'->>'hash' END`);
  return sql`(${revision} IS NULL OR ${hash("outcome_contract")} = ${revision} OR ${hash("success_criteria")} = ${revision})`;
}

function taskAttention(userId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ai_executions x WHERE x.linked_task_id = ${tasks.id}
      AND x.project_id = ${tasks.projectId} AND x.user_id = ${userId} AND x.status = 'paused'
      AND x.id = (SELECT n.id FROM ai_executions n WHERE n.linked_task_id = ${tasks.id}
        AND n.project_id = ${tasks.projectId} AND n.user_id = ${userId}
        ORDER BY n.created_at DESC, n.id DESC LIMIT 1)
  )`;
}

function taskGroupExpression(userId: string): SQL<Group> {
  const attention = taskAttention(userId);
  return sql`CASE
    WHEN ${attention} THEN 'decisions'
    WHEN ${tasks.status} IN ('completed','failed','cancelled') THEN 'recent'
    WHEN ${tasks.status} IN ('pending','queued','running','verifying') THEN 'active'
    ELSE NULL
  END`;
}

function missionAttention(): SQL {
  return sql`(${missions.status} IN ('blocked','needs_replan','waiting') OR (${missions.status} NOT IN ('completed','failed','cancelled') AND EXISTS (
    SELECT 1 FROM ai_goals g WHERE g.mission_id = ${missions.id}
      AND g.project_id = ${missions.projectId} AND ${currentGoal("g", "ai_missions")}
      AND (g.status IN ('waiting_for_approval','blocked','failed','needs_replan') OR EXISTS (
        SELECT 1 FROM ai_executions x WHERE x.goal_id = g.id
          AND x.project_id = ${missions.projectId} AND x.user_id = ${missions.userId}
          AND x.status = 'paused'
          AND x.id = (SELECT n.id FROM ai_executions n WHERE n.goal_id = g.id
            AND n.project_id = ${missions.projectId} AND n.user_id = ${missions.userId}
            ORDER BY n.created_at DESC, n.id DESC LIMIT 1)
      ))
  )))`;
}

function missionGroupExpression(): SQL<Group> {
  const attention = missionAttention();
  return sql`CASE
    WHEN ${attention} THEN 'decisions'
    WHEN ${missions.status} IN ('completed','failed','cancelled') THEN 'recent'
    WHEN ${missions.status} IN ('draft','active') THEN 'active'
    ELSE NULL
  END`;
}

function executionGroupExpression(): SQL<Group> {
  return sql`CASE
    WHEN ${executions.status} = 'paused' THEN 'decisions'
    WHEN ${executions.status} IN ('completed','failed','cancelled') THEN 'recent'
    WHEN ${executions.status} IN ('queued','running','cancelling') THEN 'active'
    ELSE NULL
  END`;
}

export function isProjectWorkRequest(raw: string, projectId: string): boolean {
  if (raw.length > 32_000) return false;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const request = value as Record<string, unknown>;
    return request.projectId === projectId && typeof request.turnIntent === "string"
      && ["PROJECT_QUERY", "EXECUTION", "IMPLEMENTATION_PLAN", "BUILD", "REPAIR", "APPLY_CHANGES", "DELIVERY", "SCAN", "TASK_EXECUTION"]
        .includes(request.turnIntent);
  } catch {
    return false;
  }
}

export function selectWorkItems(items: DashboardWorkSummaryItem[]): DashboardWorkSummaryItem[] {
  return [...new Map(items.map((item) => [`${item.kind}:${item.id}`, item])).values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .slice(0, WORK_SECTION_LIMIT);
}

const text = (value: string): string => redactUserFacingText(value.slice(0, 2_000)).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 180);
const hrefProject = (projectId: string) => `projectId=${encodeURIComponent(projectId)}`;

export async function loadDashboardWorkSummary(userId: string): Promise<DashboardWorkSummary> {
  return db.transaction(async (tx) => {
    // Bound database work as well as response size; a timeout is an error,
    // never an empty successful summary. No writes/dispatch/reconciliation.
    await tx.execute(sql`SET LOCAL statement_timeout = '3000ms'`);
    const sections: Record<Group, DashboardWorkSummaryItem[]> = { decisions: [], active: [], recent: [] };

    // Read each source once, classifying rows in PostgreSQL and applying the
    // existing per-section look-ahead bound with ROW_NUMBER. This keeps the
    // repeatable-read snapshot while replacing nine serial source reads with
    // three bounded reads.
    const missionSection = missionGroupExpression();
    const rankedMissions = tx.select({
      section: missionSection.as("section"),
      id: missions.id,
      projectId: missions.projectId,
      projectName: projects.name,
      title: missions.title,
      status: missions.status,
      updatedAt: missions.updatedAt,
      autonomyPolicy: sql<Record<string, unknown>>`jsonb_build_object('activePlanRevision', ${missions.autonomyPolicy}->'activePlanRevision')`,
      position: sql<number>`row_number() over (
        partition by ${missionSection}
        order by ${missions.updatedAt} desc, ${missions.id} asc
      )`.as("position"),
    }).from(missions).innerJoin(projects, eq(missions.projectId, projects.id))
      .where(and(eq(projects.ownerId, userId), eq(missions.userId, userId)))
      .as("ranked_missions");
    const missionRows = await tx.select({
      section: rankedMissions.section,
      id: rankedMissions.id,
      projectId: rankedMissions.projectId,
      projectName: rankedMissions.projectName,
      title: rankedMissions.title,
      status: rankedMissions.status,
      updatedAt: rankedMissions.updatedAt,
      autonomyPolicy: rankedMissions.autonomyPolicy,
    }).from(rankedMissions)
      .where(and(sql`${rankedMissions.section} IS NOT NULL`, lte(rankedMissions.position, WORK_SOURCE_LIMIT)))
      .orderBy(rankedMissions.section, desc(rankedMissions.updatedAt), rankedMissions.id);

    const taskSection = taskGroupExpression(userId);
    const rankedTasks = tx.select({
      section: taskSection.as("section"),
      id: tasks.id,
      projectId: tasks.projectId,
      projectName: projects.name,
      title: tasks.title,
      status: tasks.status,
      updatedAt: tasks.updatedAt,
      goalId: tasks.goalId,
      position: sql<number>`row_number() over (
        partition by ${taskSection}
        order by ${tasks.updatedAt} desc, ${tasks.id} asc
      )`.as("position"),
    }).from(tasks).innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(eq(projects.ownerId, userId), sql`NOT EXISTS (
        SELECT 1 FROM ai_goals g JOIN ai_missions m ON m.id = g.mission_id
        WHERE g.id = ${tasks.goalId} AND g.project_id = ${tasks.projectId}
          AND m.project_id = ${tasks.projectId} AND m.user_id = ${userId}
          AND ${currentGoal()}
      )`))
      .as("ranked_tasks");
    const taskRows = await tx.select({
      section: rankedTasks.section,
      id: rankedTasks.id,
      projectId: rankedTasks.projectId,
      projectName: rankedTasks.projectName,
      title: rankedTasks.title,
      status: rankedTasks.status,
      updatedAt: rankedTasks.updatedAt,
      goalId: rankedTasks.goalId,
    }).from(rankedTasks)
      .where(and(sql`${rankedTasks.section} IS NOT NULL`, lte(rankedTasks.position, WORK_SOURCE_LIMIT)))
      .orderBy(rankedTasks.section, desc(rankedTasks.updatedAt), rankedTasks.id);

    const executionSection = executionGroupExpression();
    const rankedExecutions = tx.select({
      section: executionSection.as("section"),
      id: executions.id,
      projectId: executions.projectId,
      projectName: projects.name,
      status: executions.status,
      updatedAt: executions.updatedAt,
      attempt: executions.attempt,
      sessionId: executions.sessionId,
      goalId: executions.goalId,
      linkedTaskId: executions.linkedTaskId,
      // Do not load checkpoints, diagnostics, resumable credentials or
      // arbitrarily large request bodies into the dashboard inventory.
      request: sql<string>`CASE WHEN length(${executions.request}) <= 32000 THEN ${executions.request} ELSE '' END`,
      position: sql<number>`row_number() over (
        partition by ${executionSection}
        order by ${executions.updatedAt} desc, ${executions.id} asc
      )`.as("position"),
    }).from(executions).innerJoin(projects, eq(executions.projectId, projects.id))
      .where(and(
        eq(projects.ownerId, userId),
        eq(executions.userId, userId),
        sql`NOT EXISTS (
          SELECT 1 FROM ai_executions n WHERE n.operation_id = ${executions.operationId}
            AND n.project_id = ${executions.projectId} AND n.user_id = ${userId}
            AND (n.created_at > ${executions.createdAt} OR
              (n.created_at = ${executions.createdAt} AND n.id > ${executions.id}))
        )`,
        sql`NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = ${executions.linkedTaskId} AND t.project_id = ${executions.projectId})`,
        sql`NOT EXISTS (
          SELECT 1 FROM ai_goals g JOIN ai_missions m ON m.id = g.mission_id
          WHERE g.id = ${executions.goalId} AND g.project_id = ${executions.projectId}
            AND m.project_id = ${executions.projectId} AND m.user_id = ${userId}
            AND ${currentGoal()}
        )`,
      ))
      .as("ranked_executions");
    const executionRows = await tx.select({
      section: rankedExecutions.section,
      id: rankedExecutions.id,
      projectId: rankedExecutions.projectId,
      projectName: rankedExecutions.projectName,
      status: rankedExecutions.status,
      updatedAt: rankedExecutions.updatedAt,
      attempt: rankedExecutions.attempt,
      sessionId: rankedExecutions.sessionId,
      goalId: rankedExecutions.goalId,
      linkedTaskId: rankedExecutions.linkedTaskId,
      request: rankedExecutions.request,
    }).from(rankedExecutions)
      .where(and(sql`${rankedExecutions.section} IS NOT NULL`, lte(rankedExecutions.position, WORK_SOURCE_LIMIT)))
      .orderBy(rankedExecutions.section, desc(rankedExecutions.updatedAt), rankedExecutions.id);

    type SummaryBatch = {
      missionRows: Array<(typeof missionRows)[number]>;
      taskRows: Array<(typeof taskRows)[number]>;
      executionRows: Array<(typeof executionRows)[number]>;
    };
    const batches: Record<Group, SummaryBatch> = {
      decisions: { missionRows: [], taskRows: [], executionRows: [] },
      active: { missionRows: [], taskRows: [], executionRows: [] },
      recent: { missionRows: [], taskRows: [], executionRows: [] },
    };
    for (const row of missionRows) batches[row.section].missionRows.push(row);
    for (const row of taskRows) batches[row.section].taskRows.push(row);
    for (const row of executionRows) batches[row.section].executionRows.push(row);
    const missionIds = [...new Set(GROUPS.flatMap((group) => batches[group].missionRows.map((mission) => mission.id)))];
    const goalRows = missionIds.length ? await tx.select({
      id: goals.id, missionId: goals.missionId, status: goals.status,
      outcomeContract: sql<Record<string, unknown>>`jsonb_build_object('planRevision', ${goals.outcomeContract}->'planRevision')`,
      successCriteria: sql<Record<string, unknown>>`jsonb_build_object('planRevision', ${goals.successCriteria}->'planRevision')`,
    }).from(goals).innerJoin(missions, and(eq(goals.missionId, missions.id), eq(goals.projectId, missions.projectId)))
      .innerJoin(projects, eq(missions.projectId, projects.id))
      .where(and(eq(projects.ownerId, userId), eq(missions.userId, userId), inArray(goals.missionId, missionIds)))
      .orderBy(goals.id).limit(GOAL_LIMIT + 1) : [];
    const goalsTruncated = goalRows.length > GOAL_LIMIT;
    let partial = goalsTruncated;
    let excludedExecutionCount = 0;
    for (const group of GROUPS) {
      const batch = { group, ...batches[group] };
      const rows = sections[group];
      if ([batch.missionRows, batch.taskRows, batch.executionRows].some((source) => source.length > WORK_SECTION_LIMIT)) partial = true;
      for (const mission of batch.missionRows) {
        // The shared helper reads only these projected metadata fields.
        const plan = projectMissionActivePlan(
          mission,
          goalRows.filter((goal) => goal.missionId === mission.id),
        );
        rows.push({
          kind: "mission", id: mission.id, projectId: mission.projectId,
          projectName: text(mission.projectName), title: text(mission.title), status: mission.status,
          updatedAt: mission.updatedAt.toISOString(), attempt: null, stateBasis: "recorded_only",
          planBinding: goalsTruncated ? "needs_details" : plan.binding === "active_revision" ? "current_plan" : plan.binding,
          href: `/missions?${hrefProject(mission.projectId)}&missionId=${encodeURIComponent(mission.id)}`,
        });
      }
      for (const task of batch.taskRows) {
        rows.push({
          kind: "task", id: task.id, projectId: task.projectId, projectName: text(task.projectName),
          title: text(task.title), status: task.status, updatedAt: task.updatedAt.toISOString(),
          attempt: null, stateBasis: "recorded_only", planBinding: task.goalId ? "needs_details" : "independent",
          href: `/tasks?${hrefProject(task.projectId)}&taskId=${encodeURIComponent(task.id)}`,
        });
      }
      for (const execution of batch.executionRows) {
        if (!isProjectWorkRequest(execution.request, execution.projectId)) {
          excludedExecutionCount++;
          partial = true;
          continue;
        }
        rows.push({
          kind: "execution", id: execution.id, projectId: execution.projectId,
          projectName: text(execution.projectName), title: "طلب عمل متعلق بالمشروع", status: execution.status,
          updatedAt: execution.updatedAt.toISOString(), attempt: execution.attempt, stateBasis: "recorded_only",
          planBinding: execution.goalId || execution.linkedTaskId ? "needs_details" : "independent",
          href: `/ai?${hrefProject(execution.projectId)}&executionId=${encodeURIComponent(execution.id)}${execution.sessionId ? `&sessionId=${encodeURIComponent(execution.sessionId)}` : ""}`,
        });
      }
      if (rows.length > WORK_SECTION_LIMIT) partial = true;
      sections[batch.group] = selectWorkItems(rows);
    }
    return {
      observedAt: new Date().toISOString(), ...sections,
      coverage: {
        partial, sectionLimit: WORK_SECTION_LIMIT, sourceLimit: WORK_SOURCE_LIMIT,
        goalsTruncated, excludedExecutionCount, totalCountAvailable: false, verification: "not_revalidated",
      },
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
