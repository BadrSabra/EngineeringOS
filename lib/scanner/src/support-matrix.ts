export type SupportLevel = "deep" | "partial" | "metadata-only";

export type SupportTargetKind = "language" | "framework";

export type SupportTarget = {
  id: string;
  label: string;
  kind: SupportTargetKind;
  level: SupportLevel;
  parser: string;
  graph: string;
  validation: string;
  changeReadiness: string;
  limitations: string[];
};

export type ProjectSupportMatrix = {
  languages: SupportTarget[];
  frameworks: SupportTarget[];
};

export type SupportMatrixEvidence = {
  parserStatuses?: Record<string, "available" | "unavailable">;
  parserFailures?: Record<string, number>;
  validationProfiles?: readonly string[];
};

const LANGUAGE_PROFILES: Record<string, Omit<SupportTarget, "id" | "label" | "kind">> = {
  typescript: {
    level: "deep",
    parser: "TypeScript compiler API",
    graph: "AST entities and source relationships",
    validation: "Generic registered profiles; no language-specific profile",
    changeReadiness: "Source-grounded planning is available",
    limitations: ["Framework-specific validation is not inferred from the language alone."],
  },
  javascript: {
    level: "deep",
    parser: "TypeScript compiler API in JavaScript mode",
    graph: "AST entities and source relationships",
    validation: "Generic registered profiles; no language-specific profile",
    changeReadiness: "Source-grounded planning is available",
    limitations: ["Framework-specific validation is not inferred from the language alone."],
  },
  python: {
    level: "deep",
    parser: "Python ast subprocess",
    graph: "AST entities and source relationships",
    validation: "Generic registered profiles; no language-specific profile",
    changeReadiness: "Source-grounded planning is available",
    limitations: ["Syntax errors or unavailable Python parsing degrade the affected file to regex evidence."],
  },
  go: {
    level: "partial",
    parser: "Go standard-library parser is registered",
    graph: "AST support is available when the Go parser completes",
    validation: "Registered go-tests profile",
    changeReadiness: "Requires a successful bounded Go validation run",
    limitations: ["Discovery keeps Go partial until parser completion and validation registration are both available."],
  },
  rust: {
    level: "partial",
    parser: "File inventory; no Rust AST extractor registered",
    graph: "File-level only",
    validation: "No Rust-specific registered profile",
    changeReadiness: "Not proven for Rust-specific changes",
    limitations: ["Crate, trait, and module relationships are not structurally extracted."],
  },
  java: {
    level: "partial",
    parser: "File inventory; no Java AST extractor registered",
    graph: "File-level only",
    validation: "No Java-specific registered profile",
    changeReadiness: "Not proven for Java-specific changes",
    limitations: ["Package, class, and dependency relationships are not structurally extracted."],
  },
  ruby: {
    level: "metadata-only",
    parser: "File inventory only",
    graph: "File-level only",
    validation: "No Ruby-specific registered profile",
    changeReadiness: "Not proven for Ruby-specific changes",
    limitations: ["No Ruby structural parser or registered validation profile is available."],
  },
  php: {
    level: "metadata-only",
    parser: "File inventory only",
    graph: "File-level only",
    validation: "No PHP-specific registered profile",
    changeReadiness: "Not proven for PHP-specific changes",
    limitations: ["No PHP structural parser or registered validation profile is available."],
  },
  csharp: {
    level: "metadata-only",
    parser: "File inventory only",
    graph: "File-level only",
    validation: "No C#-specific registered profile",
    changeReadiness: "Not proven for C#-specific changes",
    limitations: ["No C# structural parser or registered validation profile is available."],
  },
  cpp: {
    level: "metadata-only",
    parser: "File inventory only",
    graph: "File-level only",
    validation: "No C++-specific registered profile",
    changeReadiness: "Not proven for C++-specific changes",
    limitations: ["No C++ structural parser or registered validation profile is available."],
  },
  c: {
    level: "metadata-only",
    parser: "File inventory only",
    graph: "File-level only",
    validation: "No C-specific registered profile",
    changeReadiness: "Not proven for C-specific changes",
    limitations: ["No C structural parser or registered validation profile is available."],
  },
  shell: {
    level: "metadata-only",
    parser: "File inventory only",
    graph: "File-level only",
    validation: "No shell-specific registered profile",
    changeReadiness: "Not proven for shell-specific changes",
    limitations: ["Shell content is not executable through model-supplied commands."],
  },
};

const FRAMEWORK_NAMES = [
  "Express",
  "Fastify",
  "Next.js",
  "Nuxt",
  "NestJS",
  "Hono",
  "Koa",
  "FastAPI",
  "Django",
  "Flask",
  "Spring Boot",
] as const;

function frameworkKey(framework: string): string | null {
  return FRAMEWORK_NAMES.find((name) => framework === name || framework.startsWith(`${name} `)) ?? null;
}

function frameworkProfile(framework: string): SupportTarget {
  return {
    id: frameworkKey(framework) ?? framework.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    label: framework,
    kind: "framework",
    level: "partial",
    parser: "Uses the detected project-language parser",
    graph: "No framework-specific graph extractor",
    validation: "No framework-specific registered validation profile",
    changeReadiness: "Source-grounded planning only",
    limitations: [
      "Framework support currently means dependency/configuration detection.",
      "Framework-specific build, test, and runtime checks are not registered.",
    ],
  };
}

export function getLanguageSupportProfile(language: string): SupportTarget {
  const profile = LANGUAGE_PROFILES[language.toLowerCase()];
  if (profile) {
    return { id: language.toLowerCase(), label: language, kind: "language", ...profile };
  }
  return {
    id: language.toLowerCase(),
    label: language,
    kind: "language",
    level: "metadata-only",
    parser: "File inventory only",
    graph: "File-level only",
    validation: "No registered validation profile",
    changeReadiness: "Not proven for this language",
    limitations: ["This language is detected but has no registered structural parser or validation profile."],
  };
}

export function buildProjectSupportMatrix(
  languages: readonly string[],
  detectedFramework: string | null,
  evidence: SupportMatrixEvidence = {},
): ProjectSupportMatrix {
  const uniqueLanguages = [...new Set(languages.filter(Boolean))];
  const languageProfiles = uniqueLanguages.map((language) => {
    const profile = getLanguageSupportProfile(language);
    if (language.toLowerCase() !== "go") return profile;

    const parserReady = evidence.parserStatuses?.go === "available";
    const parserFailures = evidence.parserFailures?.go ?? 0;
    const validationReady = evidence.validationProfiles?.includes("go-tests") ?? false;
    if (parserReady && parserFailures === 0 && validationReady) {
      return {
        ...profile,
        level: "deep" as const,
        parser: "Go standard-library go/parser",
        graph: "Package, type, function, and internal import relationships",
        validation: "Registered go-tests profile: go test ./...",
        changeReadiness: "Source-grounded planning plus bounded Go validation",
        limitations: ["A successful validation run is still required before promotion."],
      };
    }
    if (parserReady && parserFailures > 0) {
      return {
        ...profile,
        parser: "Go standard-library go/parser",
        graph: "AST relationships for successfully parsed files",
        limitations: ["One or more Go files failed parsing; structural proof is incomplete for those files."],
      };
    }
    if (!validationReady) {
      return {
        ...profile,
        limitations: ["The Go parser is registered, but no approved Go validation profile is available."],
      };
    }
    return profile;
  });
  return {
    languages: languageProfiles,
    frameworks: detectedFramework ? [frameworkProfile(detectedFramework)] : [],
  };
}