import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";

const MAX_CONTENT_SCAN_BYTES = 1024 * 1024;

const paths = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 128 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean);
const suspicious = [];
for (const path of paths) {
  if (/(?:^|\/)(?:id_(?:rsa|ed25519|ecdsa)|.*\.(?:pem|key|ppk))$/i.test(path) || path.includes("\r")) {
    suspicious.push({ path, reason: "private-key-like path" });
    continue;
  }
  if (path === "scripts/reject-private-key-files.mjs") continue;

  let fileStat;
  try {
    fileStat = lstatSync(path);
  } catch {
    // A tracked path can be absent in a sparse checkout; there is no content
    // to inspect in that case.
    continue;
  }
  // Never follow repository-controlled symlinks or open special files. Apart
  // from avoiding false positives outside the repository, this prevents a
  // tracked link to a device/FIFO from blocking or exhausting the CI runner.
  if (!fileStat.isFile()) continue;

  let descriptor;
  let content;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const buffer = Buffer.allocUnsafe(Math.min(fileStat.size, MAX_CONTENT_SCAN_BYTES));
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    content = buffer.subarray(0, bytesRead);
  } catch {
    continue;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (
    content.includes("-----BEGIN OPENSSH PRIVATE KEY-----")
    || content.includes("-----BEGIN RSA PRIVATE KEY-----")
    || content.includes("-----BEGIN EC PRIVATE KEY-----")
    || content.includes("-----BEGIN DSA PRIVATE KEY-----")
    || content.includes("-----BEGIN PRIVATE KEY-----")
    || content.includes("openssh-key-v1\0")
  ) {
    suspicious.push({ path, reason: "private-key marker in tracked content" });
  }
}

if (suspicious.length > 0) {
  console.error("Private-key-like paths are tracked; remove them before committing.");
  for (const entry of suspicious) console.error(JSON.stringify(entry));
  process.exit(1);
}