type ChatFunction = typeof import("../agents/chat-agent.js").chat;

/**
 * Direct chat() tests stand in for the API adapter, which supplies durable
 * lifecycle observers. Preserve explicit callbacks and fill absent test sinks.
 */
export async function loadChatWithTestLifecycleSinks(): Promise<ChatFunction> {
  const { chat } = await import("../agents/chat-agent.js");
  return ((options: Parameters<ChatFunction>[0]) =>
    chat({
      ...options,
      onReadOnlyInvocation:
        options.onReadOnlyInvocation ?? (async () => undefined),
      onToolInvocation:
        options.onToolInvocation ?? (async () => undefined),
    })) as ChatFunction;
}
