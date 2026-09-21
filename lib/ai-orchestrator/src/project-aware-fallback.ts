import type { ProjectQueryTarget } from "./project-query-target.js";

export type ProjectAwareFallbackBasis =
  | "project_target"
  | "graph_entity"
  | "graph_relationship"
  | "explicit_file";

export type ProjectAwareFallbackSubQuery = {
  id: string;
  question: string;
  basis: ProjectAwareFallbackBasis;
  navigationHints: string[];
};

type GraphEntityHint = {
  name: string;
  path?: string;
  kind?: string;
};

type GraphRelationshipHint = {
  source: string;
  relation: string;
  target: string;
};

type FallbackDomain = "embedded-ai" | "delivery" | "auth" | "gap-analysis" | "project";

const MAX_SUB_QUERIES = 5;
const MAX_GRAPH_ENTITIES = 8;
const MAX_GRAPH_RELATIONSHIPS = 8;
const MAX_EXPLICIT_PATHS = 4;

function normalizePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+/, "")
    .trim()
    .replace(/\/+$/, "");
}

function cleanGraphLabel(value: string): string {
  return value
    .replace(/\s+\[[^\]]+\]\s*$/, "")
    .replace(/\s+\[heuristic\]\s*$/, "")
    .replace(/\s+—.*$/, "")
    .replace(/[`\\]/g, "")
    .trim()
    .slice(0, 100);
}

function graphEntityHints(graphSummary: string): GraphEntityHint[] {
  if (!graphSummary || /(?:knowledge graph|graph entities) (?:empty|unavailable|not loaded)/iu.test(graphSummary)) {
    return [];
  }

  const hints: GraphEntityHint[] = [];
  for (const line of graphSummary.split("\n")) {
    const match = line.match(/^\s*•\s+(.+)$/u);
    if (!match || match[1].includes("→")) continue;
    const body = match[1];
    const name = cleanGraphLabel(
      body
        .replace(/\s+<[^>]+>/u, "")
        .replace(/\s+\([^)]*\)/u, "")
        .replace(/\s+\[[^\]]+\]/u, "")
        .replace(/\s+\{[^}]+\}/u, ""),
    );
    if (!name || name.length < 2) continue;

    const pathMatch = body.match(
      /((?:artifacts|lib|src|packages|test|tests|spec|specs|fixtures|mocks|__tests__|__fixtures__|__mocks__)\/[\w.@/-]+\.[A-Za-z0-9]+)/u,
    );
    const kind = body.match(/<([^>]+)>/u)?.[1]?.trim();
    if (hints.some((hint) => hint.name === name)) continue;
    hints.push({
      name,
      ...(pathMatch?.[1] ? { path: normalizePath(pathMatch[1]) } : {}),
      ...(kind ? { kind: kind.slice(0, 60) } : {}),
    });
    if (hints.length >= MAX_GRAPH_ENTITIES) break;
  }
  return hints;
}

function graphRelationshipHints(graphSummary: string): GraphRelationshipHint[] {
  if (!graphSummary) return [];
  const hints: GraphRelationshipHint[] = [];
  for (const line of graphSummary.split("\n")) {
    const match = line.match(
      /^\s*•\s+(.+?)\s+→\s+(.+?)\s+→\s+(.+?)(?:\s+\[[^\]]+\])?(?:\s+\[heuristic\])?\s*$/u,
    );
    if (!match) continue;
    const source = cleanGraphLabel(match[1]);
    const relation = cleanGraphLabel(match[2]);
    const target = cleanGraphLabel(match[3]);
    if (!source || !relation || !target) continue;
    const key = `${source}|${relation}|${target}`;
    if (hints.some((hint) => `${hint.source}|${hint.relation}|${hint.target}` === key)) continue;
    hints.push({ source, relation, target });
    if (hints.length >= MAX_GRAPH_RELATIONSHIPS) break;
  }
  return hints;
}

function detectDomain(
  message: string,
  target: ProjectQueryTarget | undefined,
): FallbackDomain {
  const haystack = [
    message,
    target?.id ?? "",
    target?.label ?? "",
    target?.promptHint ?? "",
  ].join(" ");
  if (/(?:embedded[-\s]?ai|embedded\s+AI|الذكاء\s+المدمج|الوكيل\s+المدمج)/iu.test(haystack)) {
    return "embedded-ai";
  }
  if (/(?:gap|weakness|missing|فجوات?|نواقص?|قدرات?\s+مفقودة)/iu.test(haystack)) {
    return "gap-analysis";
  }
  if (/(?:delivery|promotion|release|candidate|التسليم|الإصدار|النشر|الترقية)/iu.test(haystack)) {
    return "delivery";
  }
  if (/(?:auth|authentication|authorization|identity|session|مصادق|مصادقة|هوية|جلسة|صلاحيات)/iu.test(haystack)) {
    return "auth";
  }
  return "project";
}

function tokens(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .split(/[\s/_.:#()[\]{}"'`?؟!,؛-]+/u)
    .filter((token) => token.length >= 3);
}

function selectRelevantEntities(
  entities: readonly GraphEntityHint[],
  message: string,
  domain: FallbackDomain,
): GraphEntityHint[] {
  const queryTokens = new Set(tokens(`${message} ${domain}`));
  return [...entities]
    .map((entity, index) => ({
      entity,
      score:
        tokens(`${entity.name} ${entity.kind ?? ""}`).reduce(
          (score, token) => score + (queryTokens.has(token) ? 3 : 0),
          0,
        ) + (index === 0 ? 0.1 : 0),
      index,
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 3)
    .map(({ entity }) => entity);
}

function addSubQuery(
  target: ProjectAwareFallbackSubQuery[],
  query: ProjectAwareFallbackSubQuery,
): void {
  if (target.length >= MAX_SUB_QUERIES) return;
  if (target.some((existing) => existing.question === query.question)) return;
  target.push(query);
}

function domainQueries(
  domain: FallbackDomain,
  language: "ar" | "en",
  target: ProjectQueryTarget | undefined,
): ProjectAwareFallbackSubQuery[] {
  const result: ProjectAwareFallbackSubQuery[] = [];
  const targetLabel = target?.id ?? (domain === "project" ? "the project" : domain);
  if (language === "ar") {
    if (domain === "embedded-ai") {
      addSubQuery(result, {
        id: "embedded-ai-evidence-responsibility",
        question: `ما مسؤولية طبقة evidence داخل ${targetLabel}؟`,
        basis: "project_target",
        navigationHints: [...(target?.primaryPaths ?? [])].slice(0, 3),
      });
      addSubQuery(result, {
        id: "embedded-ai-claim-acceptance-flow",
        question: "كيف ينتقل claim من read إلى acceptance؟",
        basis: "project_target",
        navigationHints: [...(target?.primaryPaths ?? [])].slice(0, 3),
      });
    } else if (domain === "delivery") {
      addSubQuery(result, {
        id: "delivery-validation-promotion",
        question: "كيف تنتقل التغييرات من candidate validation إلى delivery أو promotion؟",
        basis: "project_target",
        navigationHints: [...(target?.primaryPaths ?? [])].slice(0, 3),
      });
    } else if (domain === "auth") {
      addSubQuery(result, {
        id: "auth-request-authorization-flow",
        question: "كيف تنتقل المصادقة من نقطة دخول الطلب إلى الهوية والجلسة ثم authorization؟",
        basis: "project_target",
        navigationHints: [...(target?.primaryPaths ?? [])].slice(0, 3),
      });
    } else if (domain === "gap-analysis") {
      addSubQuery(result, {
        id: "gap-missing-capability-proof",
        question: "ما القدرة أو claim الذي ما زال يفتقد قراءة مصدر أو قبولًا مثبتًا؟",
        basis: "project_target",
        navigationHints: [...(target?.primaryPaths ?? [])].slice(0, 3),
      });
    } else {
      addSubQuery(result, {
        id: "project-component-responsibilities",
        question: "ما مسؤولية كل مكوّن رئيسي، وما الحد الفاصل بينه وبين المكوّن التالي؟",
        basis: "project_target",
        navigationHints: [...(target?.primaryPaths ?? [])].slice(0, 3),
      });
    }
  } else if (domain === "embedded-ai") {
    addSubQuery(result, {
      id: "embedded-ai-evidence-responsibility",
      question: `What is the responsibility of the evidence layer inside ${targetLabel}?`,
      basis: "project_target",
      navigationHints: [...(target?.primaryPaths ?? [])].slice(0, 3),
    });
    addSubQuery(result, {
      id: "embedded-ai-claim-acceptance-flow",
      question: "How does a claim move from read to acceptance?",
      basis: "project_target",
      navigationHints: [...(target?.primaryPaths ?? [])].slice(0, 3),
    });
  } else if (domain === "delivery") {
    addSubQuery(result, {
      id: "delivery-validation-promotion",
      question: "How do changes move from candidate validation to delivery or promotion?",
      basis: "project_target",
      navigationHints: [...(target?.primaryPaths ?? [])].slice(0, 3),
    });
  } else if (domain === "auth") {
    addSubQuery(result, {
      id: "auth-request-authorization-flow",
      question: "How does authentication move from request entry through identity/session to authorization?",
      basis: "project_target",
      navigationHints: [...(target?.primaryPaths ?? [])].slice(0, 3),
    });
  } else if (domain === "gap-analysis") {
    addSubQuery(result, {
      id: "gap-missing-capability-proof",
      question: "Which capability or claim still lacks a retained source read or accepted proof?",
      basis: "project_target",
      navigationHints: [...(target?.primaryPaths ?? [])].slice(0, 3),
    });
  } else {
    addSubQuery(result, {
      id: "project-component-responsibilities",
      question: "What responsibility does each major component own, and where is the boundary to the next component?",
      basis: "project_target",
      navigationHints: [...(target?.primaryPaths ?? [])].slice(0, 3),
    });
  }
  return result;
}

export function deriveProjectAwareFallbackSubQueries(params: {
  message?: string;
  projectTarget?: ProjectQueryTarget;
  graphSummary?: string;
  explicitPaths?: readonly string[];
  language?: "ar" | "en";
}): ProjectAwareFallbackSubQuery[] {
  const language = params.language ?? "en";
  const message = params.message ?? "";
  const domain = detectDomain(message, params.projectTarget);
  const entities = selectRelevantEntities(
    graphEntityHints(params.graphSummary ?? ""),
    message,
    domain,
  );
  const relationships = graphRelationshipHints(params.graphSummary ?? "");
  const explicitPaths = [...new Set(
    (params.explicitPaths ?? []).map(normalizePath).filter(Boolean),
  )].slice(0, MAX_EXPLICIT_PATHS);
  const result = domainQueries(domain, language, params.projectTarget);

  // Explicitly named files are the strongest navigation signal supplied by
  // the user. Reserve those questions before spending the bounded budget on
  // graph-derived hints.
  for (const filePath of explicitPaths) {
    if (result.length >= MAX_SUB_QUERIES) break;
    const question = language === "ar"
      ? `ما السلوك الذي تملكه \`${filePath}\`، وما الذي تسلّمه إلى الخطوة التالية؟`
      : `What behavior does \`${filePath}\` own, and what does it hand off to the next step?`;
    addSubQuery(result, {
      id: `explicit-file-${result.length + 1}`,
      question,
      basis: "explicit_file",
      navigationHints: [`explicit file: ${filePath}`],
    });
  }

  for (const entity of entities) {
    if (result.length >= MAX_SUB_QUERIES) break;
    const question = language === "ar"
      ? `ما مسؤولية \`${entity.name}\`، وكيف تتصل بالهدف ${domain}؟`
      : `What responsibility does \`${entity.name}\` own, and how does it connect to the ${domain} target?`;
    addSubQuery(result, {
      id: `graph-entity-${result.length + 1}`,
      question,
      basis: "graph_entity",
      navigationHints: [
        `graph entity: ${entity.name}`,
        ...(entity.kind ? [`kind: ${entity.kind}`] : []),
        ...(entity.path ? [`path hint: ${entity.path}`] : []),
      ],
    });
  }

  for (const relationship of relationships) {
    if (result.length >= MAX_SUB_QUERIES) break;
    const question = language === "ar"
      ? `ما نقطة الربط بين \`${relationship.source}\` و\`${relationship.target}\` عبر \`${relationship.relation}\`؟`
      : `What is the integration point between \`${relationship.source}\` and \`${relationship.target}\` through \`${relationship.relation}\`?`;
    addSubQuery(result, {
      id: `graph-relationship-${result.length + 1}`,
      question,
      basis: "graph_relationship",
      navigationHints: [
        `graph relationship: ${relationship.source} → ${relationship.relation} → ${relationship.target}`,
      ],
    });
  }

  return result.slice(0, MAX_SUB_QUERIES);
}

export function buildProjectAwareFallbackSection(params: {
  message?: string;
  projectTarget?: ProjectQueryTarget;
  graphSummary?: string;
  explicitPaths?: readonly string[];
  language?: "ar" | "en";
}): string {
  const language = params.language ?? "en";
  const queries = deriveProjectAwareFallbackSubQueries(params);
  if (queries.length === 0) return "";

  const heading = language === "ar"
    ? "## أسئلة فرعية موجهة بالمشروع"
    : "## Project-aware sub-queries";
  const explanation = language === "ar"
    ? "هذه الأسئلة مشتقة من الهدف والملفات المذكورة وإشارات graph. الكيانات والعلاقات هنا لإرشاد القراءة فقط وليست دليلًا نهائيًا؛ القبول يتطلب قراءات مصدر كاملة ومثبتة."
    : "These questions are derived from the target, named files, and graph hints. Graph entities and relationships guide navigation only; they are not final evidence. Acceptance still requires complete retained source reads.";
  const lines = queries.map((query) => {
    const hints = query.navigationHints.length > 0
      ? query.navigationHints.map((hint) => `\`${hint}\``).join(", ")
      : language === "ar" ? "لا توجد إشارة مسار" : "no path hint";
    return language === "ar"
      ? `- ${query.question}\n  - إشارة القراءة: ${hints}`
      : `- ${query.question}\n  - Navigation hint: ${hints}`;
  });
  return `${heading}\n\n${explanation}\n\n${lines.join("\n")}`;
}