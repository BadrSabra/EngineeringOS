export const MAX_TOOL_OUTPUT_SERIALIZATION_BYTES = 2_000_000;
export const MAX_VALIDATION_TOOL_RESULT_BYTES = 1_000_000;
export const MAX_ANALYSIS_TOOL_OUTPUT_BYTES = 20_000;
export const MAX_ANALYSIS_TOOL_RESULT_BYTES = 24_000;

export class ToolOutputLimitExceeded extends Error {
  readonly code = "TOOL_OUTPUT_LIMIT" as const;

  constructor(
    readonly outputBytes: number,
    readonly maxBytes: number,
  ) {
    super("Tool output exceeded its server-owned byte limit.");
    this.name = "ToolOutputLimitExceeded";
  }
}

export function isToolOutputLimitExceeded(error: unknown): error is ToolOutputLimitExceeded {
  if (error instanceof ToolOutputLimitExceeded) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; outputBytes?: unknown; maxBytes?: unknown };
  return candidate.code === "TOOL_OUTPUT_LIMIT"
    && typeof candidate.outputBytes === "number"
    && typeof candidate.maxBytes === "number";
}

type SerializationBudget = {
  bytes: number;
  maxBytes: number;
  ancestors: Set<object>;
};

function addBytes(budget: SerializationBudget, bytes: number): void {
  budget.bytes += bytes;
  if (budget.bytes > budget.maxBytes) {
    throw new ToolOutputLimitExceeded(budget.bytes, budget.maxBytes);
  }
}

function utf8BytesForJsonCodeUnit(value: string, index: number): { bytes: number; advance: number } {
  const code = value.charCodeAt(index);
  if (code === 0x22 || code === 0x5c) return { bytes: 2, advance: 1 };
  if (code <= 0x1f) {
    return {
      bytes: code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d
        ? 2
        : 6,
      advance: 1,
    };
  }
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = value.charCodeAt(index + 1);
    return next >= 0xdc00 && next <= 0xdfff
      ? { bytes: 4, advance: 2 }
      : { bytes: 6, advance: 1 };
  }
  if (code >= 0xdc00 && code <= 0xdfff) return { bytes: 6, advance: 1 };
  if (code <= 0x7f) return { bytes: 1, advance: 1 };
  if (code <= 0x7ff) return { bytes: 2, advance: 1 };
  return { bytes: 3, advance: 1 };
}

function utf8BytesForRawCodeUnit(value: string, index: number): { bytes: number; advance: number } {
  const code = value.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff) {
    const next = value.charCodeAt(index + 1);
    return next >= 0xdc00 && next <= 0xdfff
      ? { bytes: 4, advance: 2 }
      : { bytes: 3, advance: 1 };
  }
  if (code >= 0xdc00 && code <= 0xdfff) return { bytes: 3, advance: 1 };
  if (code <= 0x7f) return { bytes: 1, advance: 1 };
  if (code <= 0x7ff) return { bytes: 2, advance: 1 };
  return { bytes: 3, advance: 1 };
}

function addJsonString(value: string, budget: SerializationBudget): void {
  addBytes(budget, 2);
  for (let index = 0; index < value.length;) {
    const encoded = utf8BytesForJsonCodeUnit(value, index);
    addBytes(budget, encoded.bytes);
    index += encoded.advance;
  }
}

function countJsonValue(
  value: unknown,
  position: "root" | "object" | "array",
  budget: SerializationBudget,
): boolean {
  if (value === null) {
    addBytes(budget, 4);
    return true;
  }
  if (typeof value === "string") {
    addJsonString(value, budget);
    return true;
  }
  if (typeof value === "boolean") {
    addBytes(budget, value ? 4 : 5);
    return true;
  }
  if (typeof value === "number") {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== "string") {
      throw new TypeError("Tool number output is not JSON-serializable.");
    }
    addBytes(budget, encoded.length);
    return true;
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    if (position === "array") {
      addBytes(budget, 4);
      return true;
    }
    if (position === "object") return false;
    throw new TypeError("Tool output root must be JSON-serializable.");
  }
  if (typeof value === "bigint") {
    throw new TypeError("BigInt values are not valid tool output.");
  }

  const objectValue = value as object & { toJSON?: unknown };
  if (Object.prototype.hasOwnProperty.call(objectValue, "toJSON")) {
    throw new TypeError("Custom toJSON output is not supported for bounded tool results.");
  }
  if (budget.ancestors.has(objectValue)) {
    throw new TypeError("Circular tool output is not JSON-serializable.");
  }
  budget.ancestors.add(objectValue);
  try {
    if (Array.isArray(objectValue)) {
      if (Object.getPrototypeOf(objectValue) !== Array.prototype) {
        throw new TypeError("Only plain arrays are valid tool output.");
      }
      addBytes(budget, 1);
      for (let index = 0; index < objectValue.length; index += 1) {
        if (index > 0) addBytes(budget, 1);
        const descriptor = Object.getOwnPropertyDescriptor(objectValue, String(index));
        if (!descriptor) {
          addBytes(budget, 4);
        } else if (!("value" in descriptor)) {
          throw new TypeError("Accessor properties are not valid tool output.");
        } else {
          countJsonValue(descriptor.value, "array", budget);
        }
      }
      addBytes(budget, 1);
      return true;
    }

    const prototype = Object.getPrototypeOf(objectValue);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Only plain objects are valid tool output.");
    }
    addBytes(budget, 1);
    let first = true;
    for (const key in objectValue) {
      if (!Object.prototype.hasOwnProperty.call(objectValue, key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
      if (!descriptor?.enumerable) continue;
      if (!("value" in descriptor)) {
        throw new TypeError("Accessor properties are not valid tool output.");
      }
      const child = descriptor.value;
      if (
        child === undefined
        || typeof child === "function"
        || typeof child === "symbol"
      ) {
        continue;
      }
      if (!first) addBytes(budget, 1);
      first = false;
      addJsonString(key, budget);
      addBytes(budget, 1);
      countJsonValue(child, "object", budget);
    }
    addBytes(budget, 1);
    return true;
  } finally {
    budget.ancestors.delete(objectValue);
  }
}

export function assertToolTextOutputWithinByteLimit(value: string, maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("Tool output limit must be a non-negative safe integer.");
  }
  const budget: SerializationBudget = { bytes: 0, maxBytes, ancestors: new Set() };
  for (let index = 0; index < value.length;) {
    const encoded = utf8BytesForRawCodeUnit(value, index);
    addBytes(budget, encoded.bytes);
    index += encoded.advance;
  }
}

export function stringifyJsonWithinByteLimit(
  value: unknown,
  maxBytes = MAX_TOOL_OUTPUT_SERIALIZATION_BYTES,
): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("Tool output limit must be a non-negative safe integer.");
  }
  const budget: SerializationBudget = { bytes: 0, maxBytes, ancestors: new Set() };
  countJsonValue(value, "root", budget);
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") {
    throw new TypeError("Tool output root must be JSON-serializable.");
  }
  const actualBytes = Buffer.byteLength(serialized, "utf8");
  if (actualBytes > maxBytes) {
    throw new ToolOutputLimitExceeded(actualBytes, maxBytes);
  }
  if (actualBytes !== budget.bytes) {
    throw new TypeError("Bounded tool output size did not match its JSON serialization.");
  }
  return serialized;
}