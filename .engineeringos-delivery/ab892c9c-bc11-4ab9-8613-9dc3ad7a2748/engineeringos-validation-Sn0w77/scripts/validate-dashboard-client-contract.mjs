import { spawnSync } from "node:child_process";

const steps = [
  {
    label: "OpenAPI and generated client drift",
    command: ["run", "codegen:check"],
  },
  {
    label: "clean API client declaration build",
    command: [
      "--filter",
      "@workspace/api-client-react",
      "exec",
      "tsc",
      "--build",
      "--clean",
    ],
  },
  {
    label: "API client declaration build",
    command: [
      "--filter",
      "@workspace/api-client-react",
      "exec",
      "tsc",
      "--build",
    ],
  },
  {
    label: "dashboard typecheck",
    command: [
      "--filter",
      "@workspace/dashboard",
      "run",
      "typecheck",
    ],
  },
];

for (const { label, command } of steps) {
  console.log(`\n[dashboard-client-contract] ${label}`);
  const result = spawnSync("pnpm", command, {
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(
      `[dashboard-client-contract] ${label} could not start: ${result.error.message}`,
    );
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(
      `[dashboard-client-contract] ${label} failed. ` +
        "The OpenAPI source, generated React client declarations, and dashboard are out of sync.",
    );
    process.exit(result.status ?? 1);
  }
}

console.log(
  "\n[dashboard-client-contract] OpenAPI, client declarations, and dashboard are in sync.",
);