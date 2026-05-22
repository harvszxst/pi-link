/**
 * PI//LINK — extension HTTP client
 *
 * Wraps the local PI//LINK server API for the Pi extension runtime. It registers
 * agents, scopes peer discovery to a network, sends and replies to messages,
 * opens SSE streams, and normalizes JSON error responses into thrown errors for
 * command/tool handlers.
 */
import type { Agent, AgentMessage } from "../types";
import type { NetworkRole } from "../types";
import type {
  AgentListResponse,
  AgentResponse,
  InboxResponse,
  MessageResponse,
} from "./types";

export interface RegisterAgentInput {
  name: string;
  networkName: string;
  networkRole: NetworkRole;
  role?: string;
  sessionId: string;
}

export interface SendMessageInput {
  fromAgentId: string;
  toAgentId: string;
  content: string;
}

export interface ReplyInput {
  fromAgentId: string;
  content: string;
}

export class PiLinkClient {
  constructor(private readonly serverUrl: string) {}

  /**
   * Checks whether the configured PI//LINK server is reachable.
   */
  async health(): Promise<unknown> {
    return await this.requestJson("/health");
  }

  /**
   * Registers the current Pi session as an agent.
   */
  async registerAgent(input: RegisterAgentInput): Promise<Agent> {
    const response = await this.requestJson<AgentResponse>("/agents/register", {
      method: "POST",
      body: {
        name: input.name,
        networkName: input.networkName,
        networkRole: input.networkRole,
        role: input.role,
        sessionId: input.sessionId,
      },
    });

    return response.agent;
  }

  /**
   * Lists online agents, optionally excluding the current agent.
   */
  async listAgents(
    excludeAgentId?: string,
    networkName?: string,
  ): Promise<Agent[]> {
    const params = new URLSearchParams();
    if (excludeAgentId !== undefined) {
      params.set("exclude", excludeAgentId);
    }
    if (networkName !== undefined) {
      params.set("network", networkName);
    }

    const query = params.size > 0 ? `?${params.toString()}` : "";
    const response = await this.requestJson<AgentListResponse>(`/agents${query}`);
    return response.agents;
  }

  /**
   * Sends a new PI//LINK message.
   */
  async sendMessage(input: SendMessageInput): Promise<AgentMessage> {
    const response = await this.requestJson<MessageResponse>("/messages", {
      method: "POST",
      body: {
        fromAgentId: input.fromAgentId,
        toAgentId: input.toAgentId,
        content: input.content,
      },
    });

    return response.message;
  }

  /**
   * Fetches an agent inbox and lets the server mark pending messages delivered.
   */
  async getInbox(agentId: string): Promise<AgentMessage[]> {
    const response = await this.requestJson<InboxResponse>(
      `/messages/inbox/${encodeURIComponent(agentId)}`,
    );
    return response.messages;
  }

  /**
   * Creates a reply to an existing PI//LINK message.
   */
  async replyToMessage(messageId: string, input: ReplyInput): Promise<AgentMessage> {
    const response = await this.requestJson<MessageResponse>(
      `/messages/${encodeURIComponent(messageId)}/reply`,
      {
        method: "POST",
        body: {
          fromAgentId: input.fromAgentId,
          content: input.content,
        },
      },
    );

    return response.message;
  }

  /**
   * Refreshes the current agent's last-seen timestamp.
   */
  async heartbeat(agentId: string): Promise<Agent> {
    const response = await this.requestJson<AgentResponse>(
      `/agents/${encodeURIComponent(agentId)}/heartbeat`,
      { method: "POST" },
    );
    return response.agent;
  }

  /**
   * Marks one message as delivered after session injection.
   */
  async markDelivered(messageId: string): Promise<AgentMessage> {
    const response = await this.requestJson<MessageResponse>(
      `/messages/${encodeURIComponent(messageId)}/delivered`,
      { method: "POST" },
    );
    return response.message;
  }

  /**
   * Opens the current agent SSE stream.
   */
  async openEvents(agentId: string, signal: AbortSignal): Promise<Response> {
    const response = await fetch(
      `${this.serverUrl}/events/${encodeURIComponent(agentId)}`,
      { signal },
    );

    if (!response.ok) {
      throw new Error(`event stream HTTP ${response.status}`);
    }

    return response;
  }

  /**
   * Calls a PI//LINK JSON endpoint and raises server errors as JavaScript errors.
   */
  private async requestJson<T>(
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

    const response = await fetch(`${this.serverUrl}${path}`, init);
    const payload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      throw new Error(readErrorPayload(payload) ?? `HTTP ${response.status}`);
    }

    return payload as T;
  }
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
