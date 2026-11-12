export const BUILDER_PROFILE = "vite-react-static-v1";

export const MAX_INPUT_ARCHIVE_BYTES = 55 * 1024 * 1024;
export const MAX_SOURCE_FILES = 5_000;
export const MAX_SOURCE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 1 * 1024 * 1024;
export const MAX_OUTPUT_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const MAX_OUTPUT_FILES = 5_000;
export const MAX_OUTPUT_FILE_BYTES = 12 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export const ALLOWED_APPLICATION_PACKAGES = Object.freeze([
  "@clerk/react",
  "@clerk/themes",
  "@hookform/resolvers",
  "@radix-ui/react-accordion",
  "@radix-ui/react-alert-dialog",
  "@radix-ui/react-aspect-ratio",
  "@radix-ui/react-avatar",
  "@radix-ui/react-checkbox",
  "@radix-ui/react-collapsible",
  "@radix-ui/react-context-menu",
  "@radix-ui/react-dialog",
  "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-hover-card",
  "@radix-ui/react-label",
  "@radix-ui/react-menubar",
  "@radix-ui/react-navigation-menu",
  "@radix-ui/react-popover",
  "@radix-ui/react-progress",
  "@radix-ui/react-radio-group",
  "@radix-ui/react-scroll-area",
  "@radix-ui/react-select",
  "@radix-ui/react-separator",
  "@radix-ui/react-slider",
  "@radix-ui/react-slot",
  "@radix-ui/react-switch",
  "@radix-ui/react-tabs",
  "@radix-ui/react-toast",
  "@radix-ui/react-toggle",
  "@radix-ui/react-toggle-group",
  "@radix-ui/react-tooltip",
  "@tanstack/react-query",
  "class-variance-authority",
  "clsx",
  "cmdk",
  "embla-carousel-react",
  "input-otp",
  "lucide-react",
  "next-themes",
  "react",
  "react-day-picker",
  "react-dom",
  "react-hook-form",
  "react-markdown",
  "react-resizable-panels",
  "recharts",
  "sonner",
  "tailwind-merge",
  "tailwindcss",
  "vaul",
  "wouter",
  "zod",
]);

export const ALLOWED_CSS_TOOL_PACKAGES = Object.freeze([
  "@tailwindcss/typography",
  "tw-animate-css",
]);

export const ALLOWED_BUILDER_DEPENDENCIES = Object.freeze([
  ...ALLOWED_APPLICATION_PACKAGES,
  ...ALLOWED_CSS_TOOL_PACKAGES,
]);

export const ALLOWED_WORKSPACE_IMPORTS = Object.freeze({
  "@workspace/api-client-react": "lib/api-client-react/src/index.ts",
  "@workspace/api-zod": "lib/api-zod/src/index.ts",
  "@workspace/ai-orchestrator": "lib/ai-orchestrator/src/index.ts",
  "@workspace/ai-orchestrator/capability-probe":
    "lib/ai-orchestrator/src/prompts/capability-probe.ts",
  "@workspace/ai-orchestrator/scan-command":
    "lib/ai-orchestrator/src/scan-command.ts",
});
