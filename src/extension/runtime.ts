import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "../types";
import { PiLinkClient } from "./client";
import { resolveConfig } from "./config";
import {
  applyRuntimeConfig,
  markConnected,
  markDisconnected,
  runtimeState,
} from "./state";
import { ensureLocalServer } from "./server-manager";
import type {
  PiLinkConfig,
  PiLinkRuntimeEvent,
  ResolvedPiLinkConfig,
} from "./types";

export interface ConnectResult {
  config: ResolvedPiLinkConfig;
  client: PiLinkClient;
}

/**
 * Resolves config, registers the current agent, and starts the SSE loop.
 */
export async function connectPiLink(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<ConnectResult> {
  disconnectPiLink();

  const config = await resolveConfig();
  await ensureLocalServer(config.values);
  const client = new PiLinkClient(config.values.serverUrl);
  const input: {
    name: string;
    networkName: string;
    networkRole: "host" | "member";
    role?: string;
    sessionId: string;
  } = {
    name: config.values.agentName,
    networkName: config.values.networkName,
    networkRole: config.values.networkAction === "create" ? "host" : "member",
    sessionId: runtimeState.sessionId,
  };

  if (config.values.agentRole !== undefined) {
    input.role = config.values.agentRole;
  }

  const agent = await client.registerAgent(input);

  markConnected(agent, config.values);
  startEventLoop(client, pi, ctx, agent.id);

  return { config, client };
}

/**
 * Stops live communication and clears active connection state.
 */
export function disconnectPiLink(): void {
  markDisconnected();
}

/**
 * Creates a client from the current resolved or runtime server URL.
 */
export async function createConfiguredClient(): Promise<PiLinkClient> {
  const config = await resolveConfig();
  applyRuntimeConfig(config.values);
  return new PiLinkClient(config.values.serverUrl);
}

/**
 * Creates a client for the current runtime server URL.
 */
export function createRuntimeClient(): PiLinkClient {
  if (runtimeState.serverUrl === undefined) {
    throw new Error("PI//LINK server URL is not configured.");
  }

  return new PiLinkClient(runtimeState.serverUrl);
}

/**
 * Starts the background SSE reconnect loop for inbound message handling.
 */
function startEventLoop(
  client: PiLinkClient,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  agentId: string,
): void {
  const abortController = new AbortController();
  runtimeState.eventAbortController = abortController;

  void runEventLoop(client, agentId, pi, ctx, abortController.signal);
}

/**
 * Keeps an SSE connection open and reconnects with simple backoff on failure.
 */
async function runEventLoop(
  client: PiLinkClient,
  agentId: string,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  signal: AbortSignal,
): Promise<void> {
  let reconnectDelayMs = 1_000;

  while (!signal.aborted) {
    try {
      await connectEventStream(client, agentId, pi, ctx, signal);
      reconnectDelayMs = 1_000;
    } catch (error) {
      runtimeState.sseConnected = false;
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
  client: PiLinkClient,
  agentId: string,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  signal: AbortSignal,
): Promise<void> {
  const response = await client.openEvents(agentId, signal);

  if (response.body === null) {
    throw new Error("event stream response had no body");
  }

  runtimeState.sseConnected = true;

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
        await handleEventFrame(frame, client, pi, ctx);
      }
    }
  } finally {
    runtimeState.sseConnected = false;
    reader.releaseLock();
  }
}

/**
 * Parses a single SSE frame and injects or notifies for inbound messages.
 */
async function handleEventFrame(
  frame: string,
  client: PiLinkClient,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  const parsed = parseEventFrame(frame);
  if (parsed === null) {
    return;
  }

  const event = parseRuntimeEvent(parsed.data);
  if (event === null) {
    return;
  }

  if (event.type === "network.host.offline") {
    ctx.ui.notify(formatHostOfflineNotice(event), "warning");
    return;
  }

  if (event.type !== "message.created") {
    return;
  }

  if (!runtimeState.autoInject) {
    ctx.ui.notify(
      `PI//LINK message from ${event.message.fromAgentId}. Check inbox to read it.`,
      "info",
    );
    return;
  }

  await injectInboundMessage(client, pi, event.message);
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
function parseRuntimeEvent(data: string): PiLinkRuntimeEvent | null {
  let value: unknown;

  try {
    value = JSON.parse(data) as unknown;
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null || !("type" in value)) {
    return null;
  }

  const event = value as PiLinkRuntimeEvent;
  if (
    event.type === "message.created" ||
    event.type === "network.host.offline"
  ) {
    return event;
  }

  return null;
}

/**
 * Displays an inbound PI//LINK message in the current Pi session.
 */
async function injectInboundMessage(
  client: PiLinkClient,
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

  await client.markDelivered(message.id);
}

/**
 * Formats the visible message body inserted into the Pi session.
 */
export function formatInboundMessage(message: AgentMessage): string {
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
 * Formats a human-readable connection summary.
 */
export function formatConnectedSummary(config: PiLinkConfig): string {
  return [
    "Connected to PI//LINK",
    `Agent: ${runtimeState.agentName ?? "unknown"}`,
    `Role: ${runtimeState.agentRole ?? "none"}`,
    `Server: ${config.serverUrl}`,
    `Network: ${config.networkName}`,
    `Auto Inject: ${config.autoInject ? "enabled" : "disabled"}`,
  ].join("\n");
}

function formatHostOfflineNotice(event: {
  networkName: string;
  hostName: string;
}): string {
  return [
    "PI//LINK network host is offline.",
    `Network: ${event.networkName}`,
    `Host: ${event.hostName}`,
    "",
    "This network is no longer available.",
    "Run /pilink setup to start or join a new PI//LINK network.",
  ].join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
