import { execFileSync } from "node:child_process";

const paths = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 128 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean);
const suspicious = paths.filter((path) =>
  /(?:^|\/)(?:id_(?:rsa|ed25519|ecdsa)|.*\.(?:pem|key|ppk))$/i.test(path)
  || path.includes("\r")
);

if (suspicious.length > 0) {
  console.error("Private-key-like paths are tracked; remove them before committing.");
  for (const path of suspicious) console.error(JSON.stringify(path));
  process.exit(1);
}