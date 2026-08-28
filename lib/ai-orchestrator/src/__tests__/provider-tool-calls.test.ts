import { describe, expect, it } from "vitest";
import {
  createContentOnlyStreamGuard,
  normalizeProviderResponse,
  normalizeProviderText,
  normalizeProviderToolCalls,
} from "../provider-tool-calls.js";
import { GroqClientError } from "../errors.js";
import type { ToolDefinition } from "../groq-client.js";

const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file",
      parameters: { type: "object" },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Queue a file change",
      parameters: { type: "object" },
    },
  },
];

const options = { tools, providerName: "fixture-provider", model: "fixture-model" };

function invalid(action: () => unknown) {
  expect(action).toThrowError(GroqClientError);
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ code: "INVALID_TOOL_CALL" });
  }
}

describe("provider tool-call normalization", () => {
  it("canonicalizes native object and JSON-string arguments without changing valid IDs", () => {
    const calls = normalizeProviderToolCalls(
      [
        {
          id: "native-id",
          type: "function",
          function: { name: "read_file", arguments: ' { "path": "src/a.ts", "nested": {"ok": true} } ' },
        },
        {
          id: "",
          type: "function",
          function: { name: "write_file", arguments: { path: "src/a.ts", content: "a" } },
        },
      ],
      options,
    );

    expect(calls[0]).toMatchObject({
      id: "native-id",
      function: {
        name: "read_file",
        arguments: '{"path":"src/a.ts","nested":{"ok":true}}',
      },
    });
    expect(calls[1]?.id).toMatch(/^native_[a-f0-9]{20}$/);
    expect(calls[1]?.function.arguments).toBe('{"path":"src/a.ts","content":"a"}');
  });

  it("rejects malformed, non-object, and unregistered native calls", () => {
    invalid(() => normalizeProviderToolCalls([
      { id: "bad", type: "function", function: { name: "read_file", arguments: "{not-json}" } },
    ], options));
    invalid(() => normalizeProviderToolCalls([
      { id: "bad", type: "function", function: { name: "read_file", arguments: "[]" } },
    ], options));
    invalid(() => normalizeProviderToolCalls([
      { id: "bad", type: "function", function: { name: "plan", arguments: "{}" } },
    ], options));
  });

  it("accepts strict XML and marker calls with newlines and nested JSON", () => {
    const xml = normalizeProviderText(
      'Before\n<tool_call>\n{"name":"read_file","arguments":{"path":"src/a.ts","meta":{"text":"quoted \\"value\\""}}}\n</tool_call>\nAfter',
      options,
    );
    const marker = normalizeProviderText(
      'prefix <|tool_call_start|>\nwrite_file({\n  "path": "src/a.ts",\n  "content": "line 1\\nline 2"\n})\n<|tool_call_end|> suffix',
      options,
    );

    expect(xml.content).toBe("Before\n\nAfter");
    expect(xml.toolCalls[0]?.function.name).toBe("read_file");
    expect(xml.toolCalls[0]?.id).toBe(
      normalizeProviderText(
        '<tool_call>{"name":"read_file","arguments":{"path":"src/a.ts","meta":{"text":"quoted \\"value\\""}}}</tool_call>',
        options,
      ).toolCalls[0]?.id,
    );
    expect(marker.content).toBe("prefix  suffix");
    expect(marker.toolCalls[0]?.function.arguments).toBe(
      '{"path":"src/a.ts","content":"line 1\\nline 2"}',
    );
  });

  it("supports legacy parameter XML and multiple calls while preserving prose", () => {
    const result = normalizeProviderText(
      [
        "Start.",
        "<tool_call><function=read_file><parameter=path>src/a.ts</parameter></function></tool_call>",
        "middle",
        '<|tool_call_start|>{"name":"read_file","arguments":{"path":"src/b.ts"}}<|tool_call_end|>',
        "end.",
      ].join(" "),
      options,
    );

    expect(result.content).toBe("Start.  middle  end.");
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls.map((call) => JSON.parse(call.function.arguments))).toEqual([
      { path: "src/a.ts" },
      { path: "src/b.ts" },
    ]);
    expect(new Set(result.toolCalls.map((call) => call.id)).size).toBe(2);
  });

  it("normalizes mixed native and textual calls through one ordered result", () => {
    const result = normalizeProviderText(
      'native follow-up <tool_call>{"name":"read_file","arguments":{"path":"src/b.ts"}}</tool_call>',
      options,
    );
    const response = {
      content: result.content,
      toolCalls: [{
        id: "native",
        type: "function" as const,
        function: { name: "write_file", arguments: { path: "src/c.ts", content: "x" } },
      }, ...result.toolCalls],
    };

    const normalized = normalizeProviderToolCalls(response.toolCalls, options);
    expect(normalized.map((call) => call.function.name)).toEqual(["write_file", "read_file"]);
    expect(normalized.every((call) => JSON.parse(call.function.arguments) instanceof Object)).toBe(true);
  });

  it("fails closed for unknown pseudo-tools, partial markers, nested-invalid, and mixed-invalid output", () => {
    invalid(() => normalizeProviderText(
      "I will plan({\"path\":\"src/a.ts\"}) now.",
      options,
    ));
    invalid(() => normalizeProviderText(
      "<|tool_call_start|>write_file({\"path\":\"src/a.ts\"})",
      options,
    ));
    invalid(() => normalizeProviderText(
      "<tool_call><function=write_file><parameter=path>x</parameter><parameter=path>y</parameter></function></tool_call>",
      options,
    ));
    invalid(() => normalizeProviderText(
      'safe <|tool_call_start|>read_file({"path":"x"})<|tool_call_end|> and <tool_call>{"name":"nope","arguments":{}}</tool_call>',
      options,
    ));
    invalid(() => normalizeProviderResponse(
      {
        content: "legitimate prose",
        toolCalls: "not-an-array" as never,
        model: "fixture",
        usage: { promptTokens: 0, completionTokens: 0 },
      },
      options,
    ));
  });

  it("leaves ordinary prose untouched and strips only successful calls", () => {
    expect(normalizeProviderText("A plan is ready. Use read_file when needed.", options)).toEqual({
      content: "A plan is ready. Use read_file when needed.",
      toolCalls: [],
    });
    expect(normalizeProviderText(
      "answer: read_file({\"path\":\"src/a.ts\"}) — done",
      options,
    )).toMatchObject({
      content: "answer:  — done",
      toolCalls: [{ function: { name: "read_file", arguments: '{"path":"src/a.ts"}' } }],
    });
  });
});

describe("content-only provider stream guard", () => {
  it("preserves plain text and handles ordinary marker prefixes across chunks", () => {
    const guard = createContentOnlyStreamGuard({ providerName: "fixture-provider" });
    const chunks = [
      ...guard.push("plain "),
      ...guard.push("<|tool_"),
      ...guard.push("call_start|>"),
    ];

    expect(chunks.join("")).toBe("plain ");
    expect(() => guard.finish()).toThrowError(GroqClientError);
  });

  it("does not leak a function marker split at a single-character boundary", () => {
    const guard = createContentOnlyStreamGuard({ providerName: "fixture-provider" });
    const chunks = [
      ...guard.push("before "),
      ...guard.push("w"),
      ...guard.push("r"),
      ...guard.push("ite_file({\"path\":\"x\"})"),
    ];

    expect(chunks.join("")).toBe("before ");
    expect(() => guard.finish()).toThrowError(GroqClientError);
  });

  it("never emits executable marker syntax as assistant content", () => {
    const guard = createContentOnlyStreamGuard({ providerName: "fixture-provider" });
    const chunks = [
      ...guard.push("before "),
      ...guard.push("write_"),
      ...guard.push('file({"path":"x"}) after'),
    ];

    expect(chunks.join("")).toBe("before ");
    expect(() => guard.finish()).toThrowError(GroqClientError);
  });
});