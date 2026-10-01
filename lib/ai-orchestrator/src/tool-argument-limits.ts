/**
 * Shared limits for provider-supplied tool arguments.
 *
 * The 2 MB raw cap preserves valid maximum-sized edits after JSON escaping.
 */
export const MAX_RAW_TOOL_ARGUMENT_BYTES = 2_000_000;

// A textual call envelope may encode a maximum-sized argument string again.
// Allow that bounded escaping overhead, then enforce the exact argument cap
// once the envelope has been parsed.
export const MAX_PROVIDER_TOOL_CALL_PAYLOAD_BYTES =
  MAX_RAW_TOOL_ARGUMENT_BYTES * 8 + 64_000;

const MAX_ARGUMENT_JSON_DEPTH = 128;

export function isOversizedRawToolArgument(
  value: unknown,
  maxBytes = MAX_RAW_TOOL_ARGUMENT_BYTES,
): boolean {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") > maxBytes;
}

/**
 * Measures the UTF-8 size JSON.stringify would produce for plain JSON data,
 * without allocating the serialized copy. Undefined means the value is too
 * large or is not bounded plain JSON.
 */
export function jsonSerializedByteLengthWithinLimit(
  value: unknown,
  maxBytes = MAX_RAW_TOOL_ARGUMENT_BYTES,
): number | undefined {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) return undefined;

  let byteLength = 0;
  const ancestors = new WeakSet<object>();

  const add = (amount: number): boolean => {
    byteLength += amount;
    return byteLength <= maxBytes;
  };

  const addJsonString = (text: string): boolean => {
    if (!add(2)) return false; // opening and closing quotes
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code === 0x22 || code === 0x5c) {
        if (!add(2)) return false;
      } else if (code <= 0x1f) {
        const shortEscape =
          code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d;
        if (!add(shortEscape ? 2 : 6)) return false;
      } else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          if (!add(4)) return false;
          index += 1;
        } else if (!add(6)) {
          return false;
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        if (!add(6)) return false;
      } else if (code <= 0x7f) {
        if (!add(1)) return false;
      } else if (code <= 0x7ff) {
        if (!add(2)) return false;
      } else if (!add(3)) {
        return false;
      }
    }
    return true;
  };

  const visit = (current: unknown, depth: number): boolean => {
    if (current === null) return add(4);
    if (typeof current === "string") return addJsonString(current);
    if (typeof current === "boolean") return add(current ? 4 : 5);
    if (typeof current === "number") {
      return add(Number.isFinite(current) ? Buffer.byteLength(String(current), "utf8") : 4);
    }
    if (typeof current !== "object" || depth > MAX_ARGUMENT_JSON_DEPTH) return false;

    if (ancestors.has(current)) return false;
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype) return false;
        const toJSON = Object.getOwnPropertyDescriptor(current, "toJSON");
        if (toJSON) return false;
        if (!add(1)) return false; // [
        for (let index = 0; index < current.length; index += 1) {
          if (index > 0 && !add(1)) return false;
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (!descriptor) {
            if (!add(4)) return false; // JSON.stringify serializes holes as null.
          } else if (!("value" in descriptor) || !visit(descriptor.value, depth + 1)) {
            return false;
          }
        }
        return add(1); // ]
      }

      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) return false;
      const toJSON = Object.getOwnPropertyDescriptor(current, "toJSON");
      if (toJSON) return false;
      if (!add(1)) return false; // {
      let first = true;
      for (const key in current as Record<string, unknown>) {
        if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor?.enumerable) continue;
        if (!descriptor || !("value" in descriptor)) return false;
        if (!first && !add(1)) return false;
        if (!addJsonString(key) || !add(1) || !visit(descriptor.value, depth + 1)) {
          return false;
        }
        first = false;
      }
      return add(1); // }
    } catch {
      return false;
    } finally {
      ancestors.delete(current);
    }
  };

  try {
    return visit(value, 0) ? byteLength : undefined;
  } catch {
    return undefined;
  }
}