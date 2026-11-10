import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const DEFAULT_MAX_LOG_BYTES = 256 * 1024;
const TRUNCATION_MARKER = Buffer.from("[earlier output truncated]\n");

function appendBounded(chunks, state, streamName, chunk, limit) {
  const taggedChunk = Buffer.concat([
    Buffer.from(`[${streamName}] `),
    Buffer.from(chunk),
  ]);
  chunks.push(taggedChunk);
  state.bytes += taggedChunk.length;

  while (state.bytes > limit && chunks.length > 0) {
    const excess = state.bytes - limit;
    const first = chunks[0];
    if (first.length <= excess) {
      chunks.shift();
      state.bytes -= first.length;
    } else {
      chunks[0] = first.subarray(excess);
      state.bytes -= excess;
    }
    state.truncated = true;
  }
}

export function runCommandWithArtifactLog(
  command,
  args,
  {
    cwd,
    env,
    label,
    outputPath,
    maxLogBytes = DEFAULT_MAX_LOG_BYTES,
  },
) {
  if (!Number.isInteger(maxLogBytes) || maxLogBytes < 1) {
    throw new TypeError("maxLogBytes must be a positive integer.");
  }

  return new Promise((resolveCommand, rejectCommand) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: outputPath ? ["ignore", "pipe", "pipe"] : "ignore",
      });
    } catch {
      rejectCommand(new Error(`${label} could not start.`));
      return;
    }

    const chunks = [];
    const captureState = { bytes: 0, truncated: false };
    let spawnError;
    if (outputPath) {
      child.stdout.on("data", (chunk) =>
        appendBounded(chunks, captureState, "stdout", chunk, maxLogBytes)
      );
      child.stderr.on("data", (chunk) =>
        appendBounded(chunks, captureState, "stderr", chunk, maxLogBytes)
      );
    }
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", async (code, signal) => {
      if (outputPath) {
        try {
          const prefix = captureState.truncated
            ? TRUNCATION_MARKER
            : Buffer.alloc(0);
          await writeFile(outputPath, Buffer.concat([prefix, ...chunks]), {
            mode: 0o600,
          });
        } catch {
          rejectCommand(
            new Error(`${label} output could not be saved to its evidence file.`),
          );
          return;
        }
      }

      if (spawnError) {
        rejectCommand(new Error(`${label} could not start.`));
      } else if (code === 0) {
        resolveCommand();
      } else {
        const outputHint = outputPath ? `; see ${outputPath}` : "";
        rejectCommand(
          new Error(
            `${label} failed (${signal ?? code ?? "unknown"})${outputHint}.`,
          ),
        );
      }
    });
  });
}
