import { describe, expect, it } from "vitest";
import {
  classifyProjectQueryInvestigationQuestion,
  hashProjectQueryFactManifest,
  hashProjectQueryFactQuestion,
  normalizeProjectQueryFactPath,
  ProjectQueryInvestigationContractSchema,
  ProjectQueryInvestigationResultSchema,
} from "../project-query-investigation.js";

describe("bounded FACT project-query investigation", () => {
  it("accepts only single, source-anchored factual questions", () => {
    expect(classifyProjectQueryInvestigationQuestion(
      "Where is the login route configured?",
    )).toBe("FACT");
    expect(classifyProjectQueryInvestigationQuestion(
      "أين تم تعريف مسار تسجيل الدخول؟",
    )).toBe("FACT");
    expect(classifyProjectQueryInvestigationQuestion(
      "How does the login request flow work?",
    )).toBe("UNSUPPORTED");
    expect(classifyProjectQueryInvestigationQuestion(
      "Where is the login route configured and how does it work?",
    )).toBe("UNSUPPORTED");
    expect(classifyProjectQueryInvestigationQuestion(
      "Which files define the architecture?",
    )).toBe("UNSUPPORTED");
  });

  it("normalizes question identity and project-relative paths deterministically", () => {
    expect(hashProjectQueryFactQuestion(" WHERE  is Login configured? "))
      .toBe(hashProjectQueryFactQuestion("where is login configured?"));
    expect(normalizeProjectQueryFactPath("src\\routes\\./login.ts"))
      .toBe("src/routes/login.ts");
    expect(normalizeProjectQueryFactPath("../secrets.env")).toBeNull();
    expect(normalizeProjectQueryFactPath("/etc/passwd")).toBeNull();
  });

  it("binds a bounded manifest to project, revision, root, and sorted paths", () => {
    const first = hashProjectQueryFactManifest({
      projectId: "project-1",
      workspaceRevision: "revision-1",
      workspaceRoot: "/managed/project",
      allowedPaths: ["src/routes/login.ts", "src/auth.ts"],
    });
    const reordered = hashProjectQueryFactManifest({
      projectId: "project-1",
      workspaceRevision: "revision-1",
      workspaceRoot: "/managed/project",
      allowedPaths: ["src/auth.ts", "src/routes/login.ts"],
    });
    expect(first).toBe(reordered);
    expect(first).not.toBe(hashProjectQueryFactManifest({
      projectId: "project-1",
      workspaceRevision: "revision-2",
      workspaceRoot: "/managed/project",
      allowedPaths: ["src/routes/login.ts", "src/auth.ts"],
    }));
  });

  it("rejects unnormalized scope and any attempt to attach canonical proof", () => {
    const contract = {
      schemaVersion: "v1",
      kind: "FACT",
      investigationId: "investigation-123",
      ownerId: "owner-1",
      projectId: "project-1",
      sessionId: "session-1",
      operationId: "operation-1",
      workspaceRevision: "revision-1",
      workspaceRoot: "/managed/project",
      question: "Where is the login route configured?",
      questionHash: hashProjectQueryFactQuestion("Where is the login route configured?"),
      requiredObligationIds: ["original-question"],
      maxFiles: 4,
      maxIterations: 2,
      maxToolCalls: 8,
      allowedPaths: ["src/routes/login.ts"],
      manifestId: hashProjectQueryFactManifest({
        projectId: "project-1",
        workspaceRevision: "revision-1",
        workspaceRoot: "/managed/project",
        allowedPaths: ["src/routes/login.ts"],
      }),
    };
    expect(ProjectQueryInvestigationContractSchema.safeParse(contract).success).toBe(true);
    expect(ProjectQueryInvestigationContractSchema.safeParse({
      ...contract,
      allowedPaths: ["../secrets.env"],
    }).success).toBe(false);
    expect(ProjectQueryInvestigationResultSchema.safeParse({
      kind: "PROJECT_QUERY_INVESTIGATION_RESULT",
      investigationId: "investigation-123",
      class: "FACT",
      status: "PROVEN",
    }).success).toBe(false);
  });
});