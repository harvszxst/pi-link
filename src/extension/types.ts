import type { ChildProcess } from "node:child_process";
import type { Agent, AgentMessage } from "../types";

export type PiLinkMode = "local" | "lan" | "remote";

export type PiLinkNetworkAction = "create" | "join";

export type ConfigSource = "env" | "config" | "default";

export interface PiLinkConfig {
  serverUrl: string;
  agentName: string;
  agentRole?: string;
  autoInject: boolean;
  mode: PiLinkMode;
  networkAction: PiLinkNetworkAction;
  networkName: string;
}

export type PiLinkConfigSources = Record<keyof PiLinkConfig, ConfigSource>;

export interface ResolvedPiLinkConfig {
  values: PiLinkConfig;
  sources: PiLinkConfigSources;
  configExists: boolean;
}

export interface PiLinkRuntimeState {
  sessionId: string;
  agentId: string | undefined;
  agentName: string | undefined;
  agentRole: string | undefined;
  serverUrl: string | undefined;
  mode: PiLinkMode;
  networkAction: PiLinkNetworkAction;
  networkName: string;
  connected: boolean;
  autoInject: boolean;
  sseConnected: boolean;
  heartbeatRunning: boolean;
  eventAbortController: AbortController | undefined;
  managedServerProcess: ChildProcess | undefined;
  managedServerPort: number | undefined;
  managedServerStartedByExtension: boolean;
}

export interface MessageCreatedEvent {
  type: "message.created";
  message: AgentMessage;
}

export interface AgentListResponse {
  agents: Agent[];
}

export interface AgentResponse {
  agent: Agent;
}

export interface MessageResponse {
  message: AgentMessage;
}

export interface InboxResponse {
  messages: AgentMessage[];
}
