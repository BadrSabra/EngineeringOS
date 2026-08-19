import { readdir, readFile } from "node:fs/promises";

const currentPid = process.pid;
const processEntries = await readdir("/proc");
const stopped = [];

for (const entry of processEntries) {
  if (!/^\d+$/.test(entry) || Number(entry) === currentPid) continue;

  try {
    const commandLine = (await readFile(`/proc/${entry}/cmdline`)).toString("utf8").split("\0");
    const isApiProcess =
      commandLine[0]?.endsWith("/node") &&
      commandLine.includes("--enable-source-maps") &&
      commandLine.includes("./dist/index.mjs");

    if (!isApiProcess) continue;

    const pid = Number(entry);
    process.kill(pid, "SIGTERM");
    stopped.push(pid);
  } catch {
    // Processes can exit between /proc enumeration and signal delivery.
  }
}

if (stopped.length > 0) {
  console.log(`Stopped stale API process(es): ${stopped.join(", ")}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
}