import type { Agent } from "../types";
import { DEFAULT_CONFIG } from "./config";
import type { PiLinkConfig, PiLinkRuntimeState } from "./types";

export const runtimeState: PiLinkRuntimeState = {
  sessionId: `session_${crypto.randomUUID()}`,
  agentId: undefined,
  agentName: undefined,
  agentRole: undefined,
  serverUrl: undefined,
  connected: false,
  autoInject: DEFAULT_CONFIG.autoInject,
  mode: DEFAULT_CONFIG.mode,
  sseConnected: false,
  heartbeatRunning: false,
  eventAbortController: undefined,
  managedServerProcess: undefined,
  managedServerPort: undefined,
  managedServerStartedByExtension: false,
};

/**
 * Stores active connection metadata after successful registration.
 */
export function markConnected(agent: Agent, config: PiLinkConfig): void {
  runtimeState.agentId = agent.id;
  runtimeState.agentName = agent.name;
  runtimeState.agentRole = agent.role;
  runtimeState.serverUrl = config.serverUrl;
  runtimeState.mode = config.mode;
  runtimeState.connected = true;
  runtimeState.autoInject = config.autoInject;
}

/**
 * Clears active connection metadata and aborts any open SSE stream.
 */
export function markDisconnected(): void {
  runtimeState.eventAbortController?.abort();
  runtimeState.agentId = undefined;
  runtimeState.agentName = undefined;
  runtimeState.agentRole = undefined;
  runtimeState.connected = false;
  runtimeState.sseConnected = false;
  runtimeState.heartbeatRunning = false;
  runtimeState.eventAbortController = undefined;
}

/**
 * Returns the active agent ID or throws when the extension is disconnected.
 */
export function requireCurrentAgentId(): string {
  if (runtimeState.agentId === undefined) {
    throw new Error("PI//LINK is not connected. Run /pilink connect first.");
  }

  return runtimeState.agentId;
}

/**
 * Updates runtime config flags without changing connection identity.
 */
export function applyRuntimeConfig(config: PiLinkConfig): void {
  runtimeState.serverUrl = config.serverUrl;
  runtimeState.mode = config.mode;
  runtimeState.autoInject = config.autoInject;
}
