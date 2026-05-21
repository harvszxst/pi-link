export type AgentStatus = "online" | "offline" | "stale";

export interface Agent {
  id: string;
  name: string;
  role?: string;
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

export type PiLinkEvent = MessageCreatedEvent;

export interface RegisterAgentInput {
  name: string;
  role?: string;
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
  | "MESSAGE_NOT_FOUND"
  | "SERVER_ERROR";

export interface JsonError {
  error: {
    code: ErrorCode;
    message: string;
  };
}
