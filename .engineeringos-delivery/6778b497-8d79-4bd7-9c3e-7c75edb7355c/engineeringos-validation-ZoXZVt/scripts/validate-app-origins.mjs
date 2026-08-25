import { strict as assert } from "node:assert";

const raw = (process.env.APP_ORIGINS ?? "").replace(
  /\$([A-Z][A-Z0-9_]*)/g,
  (_, name) => process.env[name] ?? "",
);
const isProduction = process.env.NODE_ENV === "production";
const entries = raw.split(",").map((origin) => origin.trim());

if (isProduction && entries.every((origin) => !origin)) {
  throw new Error(
    "APP_ORIGINS must contain at least one approved dashboard origin in production.",
  );
}

const normalized = [];
for (const entry of entries.filter(Boolean)) {
  let parsed;
  try {
    parsed = new URL(entry);
  } catch {
    throw new Error(`Invalid APP_ORIGINS entry "${entry}": expected a URL.`);
  }
  assert(
    parsed.protocol === "http:" || parsed.protocol === "https:",
    `Invalid APP_ORIGINS entry "${entry}": expected http or https.`,
  );
  assert(!parsed.username && !parsed.password, `Invalid APP_ORIGINS entry "${entry}": credentials are not allowed.`);
  assert(
    parsed.pathname === "/" && !parsed.search && !parsed.hash,
    `Invalid APP_ORIGINS entry "${entry}": expected a bare origin without a path, query, or hash.`,
  );
  const origin = parsed.origin;
  assert(!normalized.includes(origin), `Duplicate APP_ORIGINS entry "${entry}".`);
  normalized.push(origin);
}

console.log(
  `Validated ${normalized.length} approved application origin${normalized.length === 1 ? "" : "s"}.`,
);