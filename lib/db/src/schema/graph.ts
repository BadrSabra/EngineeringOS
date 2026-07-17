import {
  pgTable,
  text,
  timestamp,
  jsonb,
  pgEnum,
  real,
  boolean,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { projectsTable } from "./projects.js";
import { scanJobsTable } from "./scan_jobs.js";

export const entityTypeEnum = pgEnum("entity_type", [
  "file",
  "function",
  "class",
  "api",
  "task",
  "rule",
  "phase",
  "module",
]);

/**
 * A single piece of evidence that justifies the existence of an entity or
 * relationship. Knowledge Graph 2.0 makes every graph element traceable to
 * its source — not just to the extractor, but to the specific file and line.
 *
 * Keep this in sync with `GraphEvidence` in lib/scanner/src/graph-extractor.ts.
 */
export type GraphEvidenceRecord = {
  file: string;
  line?: number;
  column?: number;
  snippet?: string;
  kind:
    | "import-statement"
    | "call-site"
    | "class-definition"
    | "function-definition"
    | "interface-definition"
    | "jsdoc"
    | "heuristic";
};

/**
 * Unified provenance record stored on every graph entity and relationship.
 * Covers both automated scanner extractors and manual/import paths so the
 * same column shape is used regardless of how the row was produced.
 *
 * Field semantics:
 *   sourceType  — broad extraction category:
 *                 "typescript-ast" | "python-ast" | "regex-fallback" |
 *                 "manual" | "discovery-import" | "provenance-registry-import"
 *   method      — the specific mechanism within that category:
 *                 "ts-compiler-api" | "python-ast-subprocess" |
 *                 "regex-heuristic" | "manual-import" |
 *                 "api-route-detection" | "manual-seed"
 *   extractedAt — ISO-8601 timestamp of when this element was produced
 *   evidence    — ≥1 records linking to the exact source location
 *                 (present for automated extractors; omitted for manual seeds)
 *
 * Backward-compat note: the former `extractor` field is replaced by
 * `sourceType`. Any historical rows with `extractor` are read as opaque JSONB
 * and are not rejected by the DB.
 */
export type GraphProvenance = {
  sourceType: string;
  method: string;
  extractedAt: string;
  evidence?: GraphEvidenceRecord[];
};

// ─── Graph Entities ───────────────────────────────────────────────────────────

export const graphEntitiesTable = pgTable(
  "graph_entities",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    /** The scan job that produced this entity — null for manually inserted entities. */
    scanJobId: text("scan_job_id").references(() => scanJobsTable.id, {
      onDelete: "set null",
    }),
    type: entityTypeEnum("type").notNull(),
    name: text("name").notNull(),
    path: text("path"),
    /** Generic metadata bag. Prefer the typed columns below for query-able fields. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),

    // ── Knowledge Graph 2.0 semantic fields ──────────────────────────────
    /**
     * Sub-kind within the entity type.
     * e.g. "arrow-function", "class-method", "decorator", "async-class"
     */
    kind: text("kind"),
    /**
     * Which extractor produced this entity.
     * One of: typescript-ast | python-ast | regex-fallback | manual
     */
    sourceType: text("source_type"),
    /** True when the entity has JSDoc, a docstring, or equivalent documentation. */
    isDocumented: boolean("is_documented"),
    /** Free-form semantic classification tags (e.g. ["auth", "public-api", "deprecated"]). */
    semanticTags: jsonb("semantic_tags").$type<string[]>(),
    /** Short human-readable description from a doc comment or declaration signature. */
    description: text("description"),
    /**
     * Extraction confidence [0, 1].
     * 1.0 = AST-level certainty; 0.5 = regex heuristic; 0.0 = unknown.
     */
    confidence: real("confidence"),
    /** Business domain this entity belongs to (e.g. "auth", "payments", "infra"). */
    domain: text("domain"),
    /** Lifecycle stage: stable | experimental | deprecated | internal. */
    lifecycle: text("lifecycle"),

    /** How this entity was discovered and by which extractor. */
    provenance: jsonb("provenance").$type<GraphProvenance>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_graph_entities_project_id").on(t.projectId),
    index("idx_graph_entities_type").on(t.type),
    index("idx_graph_entities_source_type").on(t.sourceType),
    index("idx_graph_entities_confidence").on(t.confidence),
  ],
);

// ─── Graph Relationships ──────────────────────────────────────────────────────

export const graphRelationshipsTable = pgTable(
  "graph_relationships",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => graphEntitiesTable.id, { onDelete: "cascade" }),
    targetId: text("target_id")
      .notNull()
      .references(() => graphEntitiesTable.id, { onDelete: "cascade" }),
    /**
     * Project this relationship belongs to — denormalised so the API can
     * filter the whole relationship table by project without joining entities.
     */
    projectId: text("project_id").references(() => projectsTable.id, {
      onDelete: "cascade",
    }),
    /** Raw relation string preserved from the extractor (e.g. "imports", "extends"). */
    relation: text("relation").notNull(),
    /** The scan job that produced this relationship. */
    scanJobId: text("scan_job_id").references(() => scanJobsTable.id, {
      onDelete: "set null",
    }),

    // ── Knowledge Graph 2.0 semantic fields ──────────────────────────────
    /**
     * Typed relationship category.
     * imports | calls | extends | implements | uses | emits | observes | produces | depends_on
     */
    relationType: text("relation_type"),
    /**
     * Fine-grained sub-classification.
     * e.g. "static-import", "dynamic-import", "type-only-import", "class-inheritance"
     */
    relationSubtype: text("relation_subtype"),
    /**
     * Edge weight for weighted graph algorithms.
     * Typically equals confidence but can be tuned independently.
     */
    weight: real("weight"),
    /**
     * Extraction confidence [0, 1].
     * Lower values indicate heuristic inference; higher values indicate AST-level certainty.
     */
    confidence: real("confidence"),
    /**
     * True when this edge was inferred by heuristic rules (e.g. regex match, name similarity)
     * rather than direct AST or parse evidence. Never trust heuristic edges without
     * corroborating evidence.
     */
    isHeuristic: boolean("is_heuristic").default(false),
    /**
     * True when this edge was observed at runtime (e.g. from trace logs or profiling),
     * not inferred by static analysis. Runtime edges have higher trustworthiness but
     * are environment-specific.
     */
    isRuntimeObserved: boolean("is_runtime_observed").default(false),
    /** Structured evidence records (file, line, snippet) that justify this relationship. */
    evidenceJson: jsonb("evidence_json").$type<GraphEvidenceRecord[]>(),
    /** Count of evidence items — indexed separately for fast cardinality queries. */
    evidenceCount: integer("evidence_count").default(0),
    /** Human-readable summary of the evidence (e.g. "2 import statements in auth.ts"). */
    evidenceSummary: text("evidence_summary"),
    /** Semantic tags shared with or derived from the source/target entities. */
    semanticTags: jsonb("semantic_tags").$type<string[]>(),
    /** Which extractor produced this relationship (mirrors GraphEntity.sourceType). */
    sourceType: text("source_type"),

    /** Generic metadata bag. Prefer the typed columns above for query-able fields. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    /** How this relationship was discovered. */
    provenance: jsonb("provenance").$type<GraphProvenance>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_graph_rels_source_id").on(t.sourceId),
    index("idx_graph_rels_target_id").on(t.targetId),
    index("idx_graph_rels_project_id").on(t.projectId),
    index("idx_graph_rels_relation_type").on(t.relationType),
    index("idx_graph_rels_confidence").on(t.confidence),
    index("idx_graph_rels_is_heuristic").on(t.isHeuristic),
    index("idx_graph_rels_created_at").on(t.createdAt),
  ],
);

export type InsertGraphEntity = typeof graphEntitiesTable.$inferInsert;
export type GraphEntity = typeof graphEntitiesTable.$inferSelect;
export type InsertGraphRelationship =
  typeof graphRelationshipsTable.$inferInsert;
export type GraphRelationship = typeof graphRelationshipsTable.$inferSelect;
