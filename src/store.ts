import { ERROR_CODES } from "./constants";
import type {
  Agent,
  AgentMessage,
  CreateMessageInput,
  ErrorCode,
  RegisterAgentInput,
  ReplyToMessageInput,
} from "./types";
import { createId, nowIso } from "./utils";

export class StoreError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

export class PiLinkStore {
  private readonly agentsById = new Map<string, Agent>();
  private readonly agentsBySessionId = new Map<string, string>();
  private readonly messagesById = new Map<string, AgentMessage>();

  registerAgent(input: RegisterAgentInput): Agent {
    const now = nowIso();
    const existingId = this.agentsBySessionId.get(input.sessionId);

    if (existingId !== undefined) {
      const existing = this.agentsById.get(existingId);
      if (existing !== undefined) {
        const updated: Agent = {
          ...existing,
          name: input.name,
          status: "online",
          lastSeenAt: now,
        };

        if (input.role !== undefined) {
          updated.role = input.role;
        } else {
          delete updated.role;
        }

        this.agentsById.set(updated.id, updated);
        return updated;
      }
    }

    const agent: Agent = {
      id: createId("agent"),
      name: input.name,
      sessionId: input.sessionId,
      status: "online",
      createdAt: now,
      lastSeenAt: now,
    };

    if (input.role !== undefined) {
      agent.role = input.role;
    }

    this.agentsById.set(agent.id, agent);
    this.agentsBySessionId.set(agent.sessionId, agent.id);

    return agent;
  }

  listAgents(excludeAgentId?: string): Agent[] {
    return Array.from(this.agentsById.values()).filter((agent) => {
      return agent.status === "online" && agent.id !== excludeAgentId;
    });
  }

  createMessage(input: CreateMessageInput): AgentMessage {
    this.assertAgentExists(input.fromAgentId, "Sender agent does not exist.");
    this.assertAgentExists(input.toAgentId, "Target agent does not exist.");

    const message: AgentMessage = {
      id: createId("msg"),
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      content: input.content,
      status: "pending",
      createdAt: nowIso(),
    };

    if (input.replyToMessageId !== undefined) {
      message.replyToMessageId = input.replyToMessageId;
    }

    this.messagesById.set(message.id, message);

    return message;
  }

  getInbox(agentId: string): AgentMessage[] {
    this.assertAgentExists(agentId, "Agent does not exist.");

    const now = nowIso();
    const messages = Array.from(this.messagesById.values()).filter((message) => {
      return message.toAgentId === agentId;
    });

    for (const message of messages) {
      if (message.status === "pending") {
        const delivered: AgentMessage = {
          ...message,
          status: "delivered",
          deliveredAt: now,
        };
        this.messagesById.set(message.id, delivered);
      }
    }

    return messages.map((message) => this.messagesById.get(message.id) ?? message);
  }

  replyToMessage(messageId: string, input: ReplyToMessageInput): AgentMessage {
    const original = this.messagesById.get(messageId);
    if (original === undefined) {
      throw new StoreError(
        ERROR_CODES.messageNotFound,
        "Message does not exist.",
      );
    }

    return this.createMessage({
      fromAgentId: input.fromAgentId,
      toAgentId: original.fromAgentId,
      content: input.content,
      replyToMessageId: original.id,
    });
  }

  touchAgent(agentId: string): Agent | null {
    const agent = this.agentsById.get(agentId);
    if (agent === undefined) {
      return null;
    }

    const updated: Agent = {
      ...agent,
      status: "online",
      lastSeenAt: nowIso(),
    };

    this.agentsById.set(updated.id, updated);

    return updated;
  }

  private assertAgentExists(agentId: string, message: string): void {
    if (!this.agentsById.has(agentId)) {
      throw new StoreError(ERROR_CODES.agentNotFound, message);
    }
  }
}

export const store = new PiLinkStore();

