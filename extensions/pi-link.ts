import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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

interface ExtensionState {
  sessionId: string;
  agentId: string | null;
  serverUrl: string;
}

const DEFAULT_SERVER_URL = "http://127.0.0.1:3007";
const DEFAULT_AGENT_NAME = "dev";
const DEFAULT_AGENT_ROLE = "developer";

const state: ExtensionState = {
  sessionId: `session_${crypto.randomUUID()}`,
  agentId: null,
  serverUrl: DEFAULT_SERVER_URL,
};

export default function piLink(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    state.serverUrl = readEnv("PI_LINK_SERVER_URL", DEFAULT_SERVER_URL);

    try {
      const agent = await registerAgent();
      state.agentId = agent.id;
      ctx.ui.notify(`PI//LINK registered as ${agent.name} (${agent.id})`, "info");
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

function requireCurrentAgentId(): string {
  if (state.agentId === null) {
    throw new Error("PI//LINK agent is not registered yet.");
  }

  return state.agentId;
}

function readEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

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

function requireStringParam(params: Record<string, string>, key: string): string {
  const value = params[key];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

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

function toolResult(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
