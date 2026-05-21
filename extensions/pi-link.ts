import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

interface Agent {
  id: string;
  name: string;
  role?: string;
  sessionId: string;
  status: string;
  createdAt: string;
  lastSeenAt: string;
}

interface AgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  status: string;
  createdAt: string;
  deliveredAt?: string;
  readAt?: string;
  replyToMessageId?: string;
}

interface MessageCreatedEvent {
  type: "message.created";
  message: AgentMessage;
}

interface ExtensionState {
  sessionId: string;
  agentId: string | null;
  serverUrl: string;
  autoInject: boolean;
  eventAbortController: AbortController | null;
}

const DEFAULT_SERVER_URL = "http://127.0.0.1:3007";
const DEFAULT_AGENT_NAME = "dev";
const DEFAULT_AGENT_ROLE = "developer";
const DEFAULT_AUTO_INJECT = true;

const state: ExtensionState = {
  sessionId: `session_${crypto.randomUUID()}`,
  agentId: null,
  serverUrl: DEFAULT_SERVER_URL,
  autoInject: DEFAULT_AUTO_INJECT,
  eventAbortController: null,
};

export default function piLink(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    stopEventLoop();
    state.serverUrl = readEnv("PI_LINK_SERVER_URL", DEFAULT_SERVER_URL);
    state.autoInject = readBooleanEnv("PI_LINK_AUTO_INJECT", DEFAULT_AUTO_INJECT);

    try {
      const agent = await registerAgent();
      state.agentId = agent.id;
      ctx.ui.notify(`PI//LINK registered as ${agent.name} (${agent.id})`, "info");
      startEventLoop(pi, ctx);
    } catch (error) {
      ctx.ui.notify(`PI//LINK registration failed: ${errorMessage(error)}`, "error");
    }
  });

  pi.registerTool({
    name: "pi_link_list_agents",
    label: "List PI//LINK Agents",
    description: "List all online PI//LINK agents except the current agent.",
    parameters: Type.Object({}),
    async execute() {
      const currentAgentId = requireCurrentAgentId();
      const agents = await requestJson<{ agents: Agent[] }>(
        `/agents?exclude=${encodeURIComponent(currentAgentId)}`,
      );

      return toolResult(formatJson(agents.agents), { agents: agents.agents });
    },
  });

  pi.registerTool({
    name: "pi_link_send_message",
    label: "Send PI//LINK Message",
    description: "Send a message to another PI//LINK agent.",
    parameters: Type.Object({
      toAgentId: Type.String({
        description: "The target PI//LINK agent ID.",
      }),
      content: Type.String({
        description: "The message content to send.",
      }),
    }),
    async execute(_toolCallId, params) {
      const currentAgentId = requireCurrentAgentId();
      const body = asStringParams(params);
      const toAgentId = requireStringParam(body, "toAgentId");
      const content = requireStringParam(body, "content");
      const response = await requestJson<{ message: AgentMessage }>("/messages", {
        method: "POST",
        body: {
          fromAgentId: currentAgentId,
          toAgentId,
          content,
        },
      });

      return toolResult(formatJson(response.message), {
        message: response.message,
      });
    },
  });

  pi.registerTool({
    name: "pi_link_check_inbox",
    label: "Check PI//LINK Inbox",
    description: "Check incoming PI//LINK messages for the current agent.",
    parameters: Type.Object({}),
    async execute() {
      const currentAgentId = requireCurrentAgentId();
      const response = await requestJson<{ messages: AgentMessage[] }>(
        `/messages/inbox/${encodeURIComponent(currentAgentId)}`,
      );

      return toolResult(formatJson(response.messages), {
        messages: response.messages,
      });
    },
  });

  pi.registerTool({
    name: "pi_link_reply",
    label: "Reply via PI//LINK",
    description: "Reply to an existing PI//LINK message.",
    parameters: Type.Object({
      messageId: Type.String({
        description: "The message ID to reply to.",
      }),
      content: Type.String({
        description: "The reply content.",
      }),
    }),
    async execute(_toolCallId, params) {
      const currentAgentId = requireCurrentAgentId();
      const body = asStringParams(params);
      const messageId = requireStringParam(body, "messageId");
      const content = requireStringParam(body, "content");
      const response = await requestJson<{ message: AgentMessage }>(
        `/messages/${encodeURIComponent(messageId)}/reply`,
        {
          method: "POST",
          body: {
            fromAgentId: currentAgentId,
            content,
          },
        },
      );

      return toolResult(formatJson(response.message), {
        message: response.message,
      });
    },
  });

  pi.registerTool({
    name: "pi_link_heartbeat",
    label: "PI//LINK Heartbeat",
    description: "Refresh the current PI//LINK agent last-seen timestamp.",
    parameters: Type.Object({}),
    async execute() {
      const currentAgentId = requireCurrentAgentId();
      const response = await requestJson<{ agent: Agent }>(
        `/agents/${encodeURIComponent(currentAgentId)}/heartbeat`,
        { method: "POST" },
      );

      return toolResult(formatJson(response.agent), { agent: response.agent });
    },
  });
}

/**
 * Registers the current Pi session as a PI//LINK agent.
 */
async function registerAgent(): Promise<Agent> {
  const response = await requestJson<{ agent: Agent }>("/agents/register", {
    method: "POST",
    body: {
      name: readEnv("PI_LINK_AGENT_NAME", DEFAULT_AGENT_NAME),
      role: readEnv("PI_LINK_AGENT_ROLE", DEFAULT_AGENT_ROLE),
      sessionId: state.sessionId,
    },
  });

  return response.agent;
}

/**
 * Starts the background SSE reconnect loop for inbound message handling.
 */
function startEventLoop(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const agentId = requireCurrentAgentId();
  const abortController = new AbortController();
  state.eventAbortController = abortController;

  void runEventLoop(agentId, pi, ctx, abortController.signal);
}

/**
 * Stops any active SSE loop before session switches or extension shutdown.
 */
function stopEventLoop(): void {
  state.eventAbortController?.abort();
  state.eventAbortController = null;
}

/**
 * Keeps an SSE connection open and reconnects with simple backoff on failure.
 */
async function runEventLoop(
  agentId: string,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  signal: AbortSignal,
): Promise<void> {
  let reconnectDelayMs = 1_000;

  while (!signal.aborted) {
    try {
      await connectEventStream(agentId, pi, ctx, signal);
      reconnectDelayMs = 1_000;
    } catch (error) {
      if (signal.aborted) {
        return;
      }

      if (!isExpectedEventStreamClose(error)) {
        console.warn(`PI//LINK event stream failed: ${errorMessage(error)}`);
      }
    }

    await sleep(reconnectDelayMs, signal);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 10_000);
  }
}

/**
 * Reads one SSE response stream and dispatches each completed event frame.
 */
async function connectEventStream(
  agentId: string,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `${state.serverUrl}/events/${encodeURIComponent(agentId)}`,
    { signal },
  );

  if (!response.ok) {
    throw new Error(`event stream HTTP ${response.status}`);
  }

  if (response.body === null) {
    throw new Error("event stream response had no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (!signal.aborted) {
      const result = await reader.read();
      if (result.done) {
        return;
      }

      buffer += decoder.decode(result.value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        await handleEventFrame(frame, pi, ctx);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Parses a single SSE frame and injects or notifies for inbound messages.
 */
async function handleEventFrame(
  frame: string,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  const parsed = parseEventFrame(frame);
  if (parsed === null || parsed.event !== "message.created") {
    return;
  }

  const event = parseMessageCreatedEvent(parsed.data);
  if (event === null) {
    return;
  }

  if (!state.autoInject) {
    ctx.ui.notify(
      `PI//LINK message from ${event.message.fromAgentId}. Check inbox to read it.`,
      "info",
    );
    return;
  }

  await injectInboundMessage(pi, event.message);
}

/**
 * Converts raw SSE frame text into event name and data strings.
 */
function parseEventFrame(frame: string): { event: string; data: string } | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event,
    data: dataLines.join("\n"),
  };
}

/**
 * Safely decodes PI//LINK message event JSON.
 */
function parseMessageCreatedEvent(data: string): MessageCreatedEvent | null {
  let value: unknown;

  try {
    value = JSON.parse(data) as unknown;
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null || !("type" in value)) {
    return null;
  }

  const event = value as MessageCreatedEvent;
  return event.type === "message.created" ? event : null;
}

/**
 * Displays an inbound PI//LINK message in the current Pi session.
 */
async function injectInboundMessage(
  pi: ExtensionAPI,
  message: AgentMessage,
): Promise<void> {
  pi.sendMessage(
    {
      customType: "pi-link-message",
      content: formatInboundMessage(message),
      display: true,
      details: {
        message,
      },
    },
    { triggerTurn: false },
  );

  await markMessageDelivered(message.id);
}

/**
 * Marks an injected message as delivered on the PI//LINK server.
 */
async function markMessageDelivered(messageId: string): Promise<AgentMessage> {
  const response = await requestJson<{ message: AgentMessage }>(
    `/messages/${encodeURIComponent(messageId)}/delivered`,
    { method: "POST" },
  );

  return response.message;
}

/**
 * Formats the visible message body inserted into the Pi session.
 */
function formatInboundMessage(message: AgentMessage): string {
  const replyLine =
    message.replyToMessageId === undefined
      ? ""
      : `\nReply to: ${message.replyToMessageId}`;

  return [
    "PI//LINK inbound message",
    "",
    `From: ${message.fromAgentId}`,
    `Message ID: ${message.id}${replyLine}`,
    "",
    message.content,
  ].join("\n");
}

/**
 * Calls a PI//LINK JSON endpoint and raises server errors as JavaScript errors.
 */
async function requestJson<T>(
  path: string,
  options: { method?: string; body?: Record<string, unknown> } = {},
): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? "GET",
  };

  if (options.body !== undefined) {
    init.headers = {
      "content-type": "application/json",
    };
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${state.serverUrl}${path}`, init);

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(readErrorPayload(payload) ?? `HTTP ${response.status}`);
  }

  return payload as T;
}

/**
 * Returns the registered agent ID or fails fast before tools call the server.
 */
function requireCurrentAgentId(): string {
  if (state.agentId === null) {
    throw new Error("PI//LINK agent is not registered yet.");
  }

  return state.agentId;
}

/**
 * Reads a non-empty environment variable or falls back to a default.
 */
function readEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

/**
 * Reads a boolean environment flag using true-by-default V3 semantics.
 */
function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === undefined || value.length === 0) {
    return fallback;
  }

  return !["0", "false", "no", "off"].includes(value);
}

/**
 * Narrows Pi tool params into a simple string dictionary.
 */
function asStringParams(params: unknown): Record<string, string> {
  if (typeof params !== "object" || params === null) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      output[key] = value;
    }
  }

  return output;
}

/**
 * Returns a required string tool parameter or throws a user-visible error.
 */
function requireStringParam(params: Record<string, string>, key: string): string {
  const value = params[key];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

/**
 * Extracts a PI//LINK JSON error message from a failed response payload.
 */
function readErrorPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || !("error" in payload)) {
    return null;
  }

  const error = payload.error;
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return null;
  }

  return typeof error.message === "string" ? error.message : null;
}

/**
 * Formats text and structured details for a Pi tool result.
 */
function toolResult(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

/**
 * Renders structured tool output for humans while preserving details for Pi.
 */
function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Normalizes unknown thrown values into readable text.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Treats routine fetch stream termination as a quiet reconnect condition.
 */
function isExpectedEventStreamClose(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  const message = errorMessage(error).toLowerCase();
  return (
    message === "terminated" ||
    message.includes("aborted") ||
    message.includes("closed")
  );
}

/**
 * Waits for a reconnect delay, resolving early when the SSE loop is aborted.
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
