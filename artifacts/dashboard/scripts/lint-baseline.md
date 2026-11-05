# Dashboard lint baseline

ESLint checks every TypeScript and TSX file under `src`, including tests. The
ruleset combines ESLint's recommended JavaScript rules, typescript-eslint's
recommended rules, and React Hooks' recommended rules. TypeScript owns undefined
name checks; ESLint's overlapping `no-undef` rule is disabled for TypeScript.

Existing findings are recorded by source path, rule, and message in
`eslint-baseline.json`. Lint fails when any such finding increases or when a new
finding appears. Fixes reduce the remaining baseline automatically. Update the
baseline only after reviewing the complete lint output and intentionally
accepting new existing debt, using `pnpm run lint:baseline:update`.

The initial measurement found 87 errors and 16 warnings across 215 source files.
