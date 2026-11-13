#!/usr/bin/env node
import {
  pairPreviewAgent,
  runPreviewAgentHeartbeatLoop,
  PreviewAgentClientError,
} from "./client.js";
import {
  checkLinuxSecretService,
  LinuxSecretServiceStore,
  PreviewAgentSecretStoreError,
} from "./linux-secret-service.js";
import { PreviewAgentLockError } from "./linux-agent-lock.js";

const USAGE = `EngineeringOS Preview Agent (Linux)

Commands:
  engineeringos-preview-agent doctor
  engineeringos-preview-agent pair --api URL --node UUID --store UUID --expires ISO_DATE
  engineeringos-preview-agent run  --api URL --node UUID

Pairing code is requested through a hidden terminal prompt and is never a command-line argument.
The key and sequence are stored in the Linux Secret Service; no project files are read or executed.
`;

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(USAGE);
    return;
  }
  if (command !== "doctor" && command !== "pair" && command !== "run") {
    throw new Error("Unknown command. Use --help.");
  }
  if (command === "doctor") {
    if (args.length > 0) throw new Error("Invalid command options. Use --help.");
    await checkLinuxSecretService();
    process.stdout.write(
      "Linux Secret Service passed a temporary write/read/delete check; no Agent was paired.\n",
    );
    return;
  }
  const options = parseOptions(
    args,
    command === "pair"
      ? ["api", "node", "store", "expires"]
      : ["api", "node"],
  );
  const apiUrl = requiredOption(options, "api");
  const nodeId = requiredOption(options, "node");
  const store = new LinuxSecretServiceStore();

  if (command === "pair") {
    const storeId = requiredOption(options, "store");
    const pairingExpiresAt = requiredOption(options, "expires");
    const pairingCode = await promptHidden("Pairing code: ");
    const paired = await pairPreviewAgent({
      apiUrl,
      nodeId,
      storeId,
      pairingCode,
      pairingExpiresAt,
      secretStore: store,
    });
    process.stdout.write(
      `Paired node ${paired.nodeId}; key fingerprint ${paired.fingerprint}.\n`,
    );
    return;
  }

  if (command === "run") {
    const identity = await store.get(nodeId);
    if (!identity || identity.state !== "active") {
      throw new PreviewAgentClientError("PREVIEW_AGENT_PAIRING_REQUIRED");
    }
    const abort = new AbortController();
    const stop = () => abort.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      process.stdout.write(`Starting heartbeat for node ${nodeId}.\n`);
      await runPreviewAgentHeartbeatLoop({
        apiUrl,
        nodeId,
        secretStore: store,
        signal: abort.signal,
        onHeartbeat(lastSeenAt) {
          process.stdout.write(`Heartbeat accepted at ${lastSeenAt}.\n`);
        },
      });
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
    return;
  }

}

function parseOptions(args: string[], allowed: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    const name = key?.startsWith("--") ? key.slice(2) : "";
    if (
      !key?.startsWith("--") ||
      !value ||
      value.startsWith("--") ||
      !allowed.includes(name) ||
      options.has(name)
    ) {
      throw new Error("Invalid command options. Use --help.");
    }
    options.set(name, value);
    index += 1;
  }
  return options;
}

function requiredOption(options: Map<string, string>, name: string): string {
  const value = options.get(name);
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

function promptHidden(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Pairing requires an interactive terminal.");
  }
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  process.stdout.write(prompt);

  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      input.removeListener("data", onData);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer | string) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          finish(new Error("Pairing cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (/^[A-Za-z0-9_-]$/.test(character) && value.length < 43) {
          value += character;
        }
      }
    };
    input.on("data", onData);
  });
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof PreviewAgentClientError) {
    process.stderr.write(`${error.code}\n`);
  } else if (error instanceof PreviewAgentSecretStoreError) {
    process.stderr.write(`${error.code}\n`);
  } else if (error instanceof PreviewAgentLockError) {
    process.stderr.write(`${error.code}\n`);
  } else if (error instanceof Error) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write("PREVIEW_AGENT_FAILED\n");
  }
  process.exitCode = 1;
});
