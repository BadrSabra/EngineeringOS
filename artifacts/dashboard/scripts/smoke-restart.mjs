import { execFileSync, spawn } from 'node:child_process';
import { createConnection } from 'node:net';

const port = Number(process.env.SMOKE_PORT || 23991);
const env = { ...process.env, PORT: String(port), BASE_PATH: '/dashboard/' };
const processes = [];

function start() {
  const child = spawn('pnpm', ['run', 'dev'], {
    cwd: new URL('..', import.meta.url),
    env,
    stdio: 'ignore',
    detached: true,
  });
  processes.push(child);
  return child;
}

function portIsOpen() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function listeningUsers() {
  try {
    return execFileSync(
      'lsof',
      ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim().split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

async function waitForPort(expected, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await portIsOpen()) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for port ${port} to be ${expected ? 'open' : 'closed'}.`);
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

try {
  const first = start();
  await waitForPort(true);
  const second = start();
  await waitForPort(true);
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (second.exitCode !== null) {
    throw new Error(`The replacement Dashboard process exited with code ${second.exitCode}.`);
  }
  if (listeningUsers().length !== 1) {
    throw new Error(`Expected one Dashboard listener after restart, found ${listeningUsers().length}.`);
  }
  console.log('Dashboard restart smoke check passed.');
} finally {
  for (const child of processes) stop(child);
  await new Promise((resolve) => setTimeout(resolve, 200));
}