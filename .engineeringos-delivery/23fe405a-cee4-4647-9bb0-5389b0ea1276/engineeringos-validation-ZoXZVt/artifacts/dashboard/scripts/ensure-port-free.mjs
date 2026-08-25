import { execFileSync } from 'node:child_process';

const port = Number(process.env.PORT || 23183);
const gracePeriodMs = 2500;
const pollIntervalMs = 50;

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${process.env.PORT || ''}"`);
}

function portUsers() {
  try {
    const output = execFileSync(
      'lsof',
      ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'],
      {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return [...output.matchAll(/\b\d+\b/g)].map((match) => Number(match[0]));
  } catch {
    // lsof exits non-zero when the port has no listening users.
    return [];
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const users = [...new Set(portUsers())].filter((pid) => pid !== process.pid);
for (const pid of users) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

const deadline = Date.now() + gracePeriodMs;
while (portUsers().length > 0 && Date.now() < deadline) {
  await sleep(pollIntervalMs);
}

const remainingUsers = [...new Set(portUsers())].filter((pid) => pid !== process.pid);
for (const pid of remainingUsers) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

if (portUsers().length > 0) {
  throw new Error(`Port ${port} did not become available after stopping its previous server.`);
}