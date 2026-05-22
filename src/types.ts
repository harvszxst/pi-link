export type AgentStatus = "online" | "offline" | "stale";

export type NetworkRole = "host" | "member";

export interface Agent {
  id: string;
  name: string;
  role?: string;
  networkName: string;
  networkRole: NetworkRole;
  sessionId: string;
  status: AgentStatus;
  createdAt: string;
  lastSeenAt: string;
}

export type MessageStatus = "pending" | "delivered" | "read";

export interface AgentMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  status: MessageStatus;
  createdAt: string;
  deliveredAt?: string;
  readAt?: string;
  replyToMessageId?: string;
}

export interface MessageCreatedEvent {
  type: "message.created";
  message: AgentMessage;
}

export interface NetworkHostOfflineEvent {
  type: "network.host.offline";
  networkName: string;
  hostAgentId: string;
  hostName: string;
}

export type PiLinkEvent = MessageCreatedEvent | NetworkHostOfflineEvent;

export interface RegisterAgentInput {
  name: string;
  role?: string;
  networkName: string;
  networkRole: NetworkRole;
  sessionId: string;
}

export interface CreateMessageInput {
  fromAgentId: string;
  toAgentId: string;
  content: string;
  replyToMessageId?: string;
}

export interface ReplyToMessageInput {
  fromAgentId: string;
  content: string;
}

export type ErrorCode =
  | "INVALID_REQUEST"
  | "AGENT_NOT_FOUND"
  | "HOST_OFFLINE"
  | "MESSAGE_NOT_FOUND"
  | "NETWORK_MISMATCH"
  | "SERVER_ERROR";

export interface JsonError {
  error: {
    code: ErrorCode;
    message: string;
  };
}
