import { execFileSync, spawn } from 'node:child_process';
import { createConnection } from 'node:net';

const port = Number(process.env.SMOKE_PORT || 23991);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid SMOKE_PORT value: "${process.env.SMOKE_PORT || ''}"`);
}

const env = { ...process.env, PORT: String(port), BASE_PATH: '/dashboard/' };
const processes = [];

function start() {
  const child = spawn('pnpm', ['run', 'dev'], {
    cwd: new URL('..', import.meta.url),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  child.on('error', (error) => {
    child.startupError = error;
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

async function waitForExit(child, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (child.exitCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return child.exitCode !== null;
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  if (!(await waitForExit(child, 3000))) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    await waitForExit(child, 3000);
  }
}

try {
  const first = start();
  await waitForPort(true);
  const second = start();
  if (!(await waitForExit(first))) {
    throw new Error(
      `The old Dashboard listener was not stopped on port ${port}; restart left the original process running.`,
    );
  }
  if (second.startupError || second.exitCode !== null) {
    throw new Error(
      `The replacement Dashboard process failed to bind port ${port} ${
        second.startupError?.message ?? `(exited with code ${second.exitCode})`
      }.`,
    );
  }
  try {
    await waitForPort(true);
  } catch (error) {
    throw new Error(
      `The replacement Dashboard process failed to bind port ${port}: ${error.message}`,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (second.exitCode !== null || listeningUsers().length !== 1) {
    throw new Error(
      `The replacement Dashboard process failed to bind port ${port}; expected one listener, found ${listeningUsers().length}.`,
    );
  }
  console.log('Dashboard restart smoke check passed.');
} finally {
  for (const child of processes) await stop(child);
  await waitForPort(false, 5000).catch(() => {
    throw new Error(`Dashboard restart smoke cleanup left port ${port} open.`);
  });
}