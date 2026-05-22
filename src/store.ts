import { ERROR_CODES } from "./constants";
import type {
  Agent,
  AgentMessage,
  CreateMessageInput,
  ErrorCode,
  NetworkHostOfflineEvent,
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

  /**
   * Creates a new agent or refreshes the existing agent for a known session ID.
   */
  registerAgent(input: RegisterAgentInput): Agent {
    const now = nowIso();
    const existingId = this.agentsBySessionId.get(input.sessionId);

    if (existingId !== undefined) {
      const existing = this.agentsById.get(existingId);
      if (existing !== undefined) {
        const updated: Agent = {
          ...existing,
          name: input.name,
          networkName: input.networkName,
          networkRole: input.networkRole,
          status: "online",
          lastSeenAt: now,
        };

        if (input.role !== undefined) {
          updated.role = input.role;
        } else {
          delete updated.role;
        }

        this.agentsById.set(updated.id, updated);
        this.markDuplicateAgentsOffline(input, updated.id);
        return updated;
      }
    }

    this.markDuplicateAgentsOffline(input);

    const agent: Agent = {
      id: createId("agent"),
      name: input.name,
      networkName: input.networkName,
      networkRole: input.networkRole,
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

  /**
   * Returns online agents, optionally hiding the caller from peer discovery.
   */
  listAgents(excludeAgentId?: string, networkName?: string): Agent[] {
    return Array.from(this.agentsById.values()).filter((agent) => {
      return (
        agent.status === "online" &&
        agent.id !== excludeAgentId &&
        (networkName === undefined || agent.networkName === networkName)
      );
    });
  }

  /**
   * Reports whether an agent ID is currently registered in memory.
   */
  hasAgent(agentId: string): boolean {
    return this.agentsById.has(agentId);
  }

  /**
   * Creates a pending message after confirming both sender and target exist.
   */
  createMessage(input: CreateMessageInput): AgentMessage {
    this.assertAgentExists(input.fromAgentId, "Sender agent does not exist.");
    this.assertAgentExists(input.toAgentId, "Target agent does not exist.");
    this.assertSameNetwork(input.fromAgentId, input.toAgentId);
    this.assertNetworkHostOnline(input.fromAgentId);

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

  /**
   * Returns an agent inbox and marks pending messages as delivered.
   */
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

  /**
   * Marks one pending message as delivered without reading the full inbox.
   */
  markMessageDelivered(messageId: string): AgentMessage {
    const message = this.messagesById.get(messageId);
    if (message === undefined) {
      throw new StoreError(
        ERROR_CODES.messageNotFound,
        "Message does not exist.",
      );
    }

    if (message.status !== "pending") {
      return message;
    }

    const delivered: AgentMessage = {
      ...message,
      status: "delivered",
      deliveredAt: nowIso(),
    };

    this.messagesById.set(delivered.id, delivered);

    return delivered;
  }

  /**
   * Creates a new message addressed back to the original message sender.
   */
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

  /**
   * Refreshes an agent's last-seen timestamp and online status.
   */
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

  /**
   * Marks an agent offline and returns a host-offline event when applicable.
   */
  markAgentOffline(agentId: string): {
    event: NetworkHostOfflineEvent;
    recipientAgentIds: string[];
  } | null {
    const agent = this.agentsById.get(agentId);
    if (agent === undefined || agent.status === "offline") {
      return null;
    }

    const offline: Agent = {
      ...agent,
      status: "offline",
      lastSeenAt: nowIso(),
    };
    this.agentsById.set(agentId, offline);

    if (offline.networkRole !== "host") {
      return null;
    }

    const recipientAgentIds = Array.from(this.agentsById.values())
      .filter((candidate) => {
        return (
          candidate.networkName === offline.networkName &&
          candidate.networkRole === "member" &&
          candidate.status === "online"
        );
      })
      .map((candidate) => candidate.id);

    return {
      event: {
        type: "network.host.offline",
        networkName: offline.networkName,
        hostAgentId: offline.id,
        hostName: offline.name,
      },
      recipientAgentIds,
    };
  }

  /**
   * Raises a stable domain error when a route references an unknown agent.
   */
  private assertAgentExists(agentId: string, message: string): void {
    if (!this.agentsById.has(agentId)) {
      throw new StoreError(ERROR_CODES.agentNotFound, message);
    }
  }

  /**
   * Blocks member sends when no host for their network is online.
   */
  private assertNetworkHostOnline(senderAgentId: string): void {
    const sender = this.agentsById.get(senderAgentId);
    if (sender === undefined || sender.networkRole === "host") {
      return;
    }

    const hostOnline = Array.from(this.agentsById.values()).some((agent) => {
      return (
        agent.networkName === sender.networkName &&
        agent.networkRole === "host" &&
        agent.status === "online"
      );
    });

    if (!hostOnline) {
      throw new StoreError(
        ERROR_CODES.hostOffline,
        "Network host is offline. This network is no longer available.",
      );
    }
  }

  /**
   * Blocks direct sends across different networks.
   */
  private assertSameNetwork(fromAgentId: string, toAgentId: string): void {
    const fromAgent = this.agentsById.get(fromAgentId);
    const toAgent = this.agentsById.get(toAgentId);

    if (
      fromAgent === undefined ||
      toAgent === undefined ||
      fromAgent.networkName === toAgent.networkName
    ) {
      return;
    }

    throw new StoreError(
      ERROR_CODES.networkMismatch,
      "Target agent is not in the current network.",
    );
  }

  /**
   * Keeps one online agent per network/name logical identity.
   */
  private markDuplicateAgentsOffline(
    input: RegisterAgentInput,
    excludeAgentId?: string,
  ): void {
    const now = nowIso();

    for (const agent of this.agentsById.values()) {
      if (
        agent.id === excludeAgentId ||
        agent.networkName !== input.networkName ||
        agent.name !== input.name ||
        agent.status === "offline"
      ) {
        continue;
      }

      const offline: Agent = {
        ...agent,
        status: "offline",
        lastSeenAt: now,
      };
      this.agentsById.set(agent.id, offline);
    }
  }
}

export const store = new PiLinkStore();
