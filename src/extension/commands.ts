import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Agent, AgentMessage } from "../types";
import {
  CONFIG_PATH,
  resolveConfig,
  saveConfig,
  updateSavedConfig,
} from "./config";
import {
  applyRuntimeConfig,
  requireCurrentAgentId,
  runtimeState,
} from "./state";
import {
  connectPiLink,
  createRuntimeClient,
  disconnectPiLink,
  formatConnectedSummary,
} from "./runtime";
import {
  getServerStatus,
  startManagedServer,
  stopManagedServer,
} from "./server-manager";
import type { ServerStatus } from "./server-manager";
import type { PiLinkConfig, PiLinkMode } from "./types";

const HELP_TEXT = [
  "PI//LINK commands:",
  "/pilink setup",
  "/pilink connect",
  "/pilink disconnect",
  "/pilink status",
  "/pilink agents",
  "/pilink send",
  "/pilink inbox",
  "/pilink auto on",
  "/pilink auto off",
  "/pilink server start",
  "/pilink server stop",
  "/pilink server status",
  "/pilink config",
  "/pilink doctor",
].join("\n");

/**
 * Registers the PI//LINK slash command and dispatches subcommands.
 */
export function registerPiLinkCommands(pi: ExtensionAPI): void {
  pi.registerCommand("pilink", {
    description: "Manage PI//LINK setup, connection, and messaging",
    getArgumentCompletions(prefix: string) {
      const commands = [
        "setup",
        "connect",
        "disconnect",
        "status",
        "agents",
        "send",
        "inbox",
        "auto on",
        "auto off",
        "server start",
        "server stop",
        "server status",
        "config",
        "doctor",
        "help",
      ];
      const matches = commands
        .filter((command) => command.startsWith(prefix.trim()))
        .map((command) => ({ value: command, label: command }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      await handlePiLinkCommand(pi, args, ctx);
    },
  });
}

async function handlePiLinkCommand(
  pi: ExtensionAPI,
  args: string,
  ctx: ExtensionContext,
): Promise<void> {
  const [command = "help", subcommand] = args.trim().split(/\s+/);

  try {
    switch (command) {
      case "setup":
        await setupCommand(ctx);
        return;
      case "connect":
        await connectCommand(pi, ctx);
        return;
      case "disconnect":
        disconnectCommand(ctx);
        return;
      case "status":
        statusCommand(ctx);
        return;
      case "agents":
        await agentsCommand(ctx);
        return;
      case "send":
        await sendCommand(ctx);
        return;
      case "inbox":
        await inboxCommand(ctx);
        return;
      case "auto":
        await autoCommand(subcommand, ctx);
        return;
      case "server":
        await serverCommand(subcommand, ctx);
        return;
      case "config":
        await configCommand(ctx);
        return;
      case "doctor":
        await doctorCommand(ctx);
        return;
      case "help":
      default:
        ctx.ui.notify(HELP_TEXT, "info");
    }
  } catch (error) {
    ctx.ui.notify(`PI//LINK error: ${errorMessage(error)}`, "error");
  }
}

async function setupCommand(ctx: ExtensionContext): Promise<void> {
  const resolved = await resolveConfig();
  const current = resolved.values;

  const agentName = await promptText(ctx, "Agent name", current.agentName);
  if (agentName === undefined) {
    return;
  }

  const agentRole = await promptText(ctx, "Agent role", current.agentRole ?? "");
  if (agentRole === undefined) {
    return;
  }

  const serverUrl = await promptText(ctx, "Server URL", current.serverUrl);
  if (serverUrl === undefined) {
    return;
  }

  const autoInjectChoice = await ctx.ui.select(
    "Auto inject?",
    current.autoInject ? ["yes", "no"] : ["no", "yes"],
  );
  if (autoInjectChoice === undefined) {
    return;
  }

  const modeChoice = await ctx.ui.select(
    "Mode?",
    current.mode === "local" ? ["local", "lan"] : ["lan", "local"],
  );
  if (modeChoice === undefined) {
    return;
  }

  const mode = modeChoice as PiLinkMode;
  if (mode === "lan") {
    ctx.ui.notify(
      "LAN mode is intended only for trusted local networks.\nDo not expose PI//LINK to the public internet.",
      "warning",
    );
  }

  const config: PiLinkConfig = {
    serverUrl,
    agentName,
    autoInject: autoInjectChoice === "yes",
    mode,
  };

  if (agentRole.trim().length > 0) {
    config.agentRole = agentRole;
  }

  await saveConfig(config);
  applyRuntimeConfig(config);
  ctx.ui.notify(`PI//LINK config saved:\n${CONFIG_PATH}`, "info");
}

async function connectCommand(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  const result = await connectPiLink(pi, ctx);
  ctx.ui.notify(formatConnectedSummary(result.config.values), "info");
}

function disconnectCommand(ctx: ExtensionContext): void {
  disconnectPiLink();
  ctx.ui.notify("Disconnected from PI//LINK", "info");
}

function statusCommand(ctx: ExtensionContext): void {
  ctx.ui.notify(
    [
      `Connection: ${runtimeState.connected ? "connected" : "disconnected"}`,
      `Agent ID: ${runtimeState.agentId ?? "none"}`,
      `Agent Name: ${runtimeState.agentName ?? "none"}`,
      `Agent Role: ${runtimeState.agentRole ?? "none"}`,
      `Server URL: ${runtimeState.serverUrl ?? "none"}`,
      `Mode: ${runtimeState.mode}`,
      `Auto Inject: ${runtimeState.autoInject ? "enabled" : "disabled"}`,
      `SSE: ${runtimeState.sseConnected ? "connected" : "disconnected"}`,
      `Heartbeat: ${runtimeState.heartbeatRunning ? "running" : "stopped"}`,
    ].join("\n"),
    "info",
  );
}

async function agentsCommand(ctx: ExtensionContext): Promise<void> {
  const client = createRuntimeClient();
  const agents = await client.listAgents(requireCurrentAgentId());

  ctx.ui.notify(formatAgents(agents), "info");
}

async function sendCommand(ctx: ExtensionContext): Promise<void> {
  const client = createRuntimeClient();
  const fromAgentId = requireCurrentAgentId();
  const agents = await client.listAgents(fromAgentId);

  if (agents.length === 0) {
    ctx.ui.notify("No connected PI//LINK peers found.", "warning");
    return;
  }

  const labels = agents.map(formatAgentLabel);
  const selected = await ctx.ui.select("Send to which PI//LINK agent?", labels);
  if (selected === undefined) {
    return;
  }

  const target = agents[labels.indexOf(selected)];
  if (target === undefined) {
    throw new Error("Selected agent was not found.");
  }

  const content = await ctx.ui.input("Message content", "Type a PI//LINK message");
  if (content === undefined || content.trim().length === 0) {
    return;
  }

  const message = await client.sendMessage({
    fromAgentId,
    toAgentId: target.id,
    content: content.trim(),
  });

  ctx.ui.notify(`Message sent to ${target.name}\nMessage ID: ${message.id}`, "info");
}

async function inboxCommand(ctx: ExtensionContext): Promise<void> {
  const client = createRuntimeClient();
  const messages = await client.getInbox(requireCurrentAgentId());
  ctx.ui.notify(formatInbox(messages), "info");
}

async function autoCommand(
  subcommand: string | undefined,
  ctx: ExtensionContext,
): Promise<void> {
  if (subcommand !== "on" && subcommand !== "off") {
    ctx.ui.notify("Usage: /pilink auto on|off", "warning");
    return;
  }

  const autoInject = subcommand === "on";
  const saved = await updateSavedConfig({ autoInject });
  runtimeState.autoInject = saved.autoInject;
  ctx.ui.notify(
    `Auto-inject ${runtimeState.autoInject ? "enabled" : "disabled"}`,
    "info",
  );
}

async function serverCommand(
  subcommand: string | undefined,
  ctx: ExtensionContext,
): Promise<void> {
  const config = await resolveConfig();

  switch (subcommand) {
    case "start": {
      if (config.values.mode !== "local") {
        ctx.ui.notify("Managed server start is only available in local mode.", "warning");
        return;
      }

      const status = await startManagedServer(config.values.serverUrl);
      ctx.ui.notify(formatServerStatus("PI//LINK Server", status), "info");
      return;
    }
    case "stop": {
      const stopped = stopManagedServer();
      ctx.ui.notify(
        stopped
          ? "Managed PI//LINK server stopped."
          : "No extension-managed PI//LINK server is running.",
        stopped ? "info" : "warning",
      );
      return;
    }
    case "status": {
      const status = await getServerStatus(config.values.serverUrl);
      ctx.ui.notify(formatServerStatus("PI//LINK Server Status", status), "info");
      return;
    }
    default:
      ctx.ui.notify("Usage: /pilink server start|stop|status", "warning");
  }
}

async function configCommand(ctx: ExtensionContext): Promise<void> {
  const config = await resolveConfig();
  const values = config.values;
  const sources = config.sources;

  ctx.ui.notify(
    [
      `serverUrl: ${values.serverUrl} ${sources.serverUrl}`,
      `agentName: ${values.agentName} ${sources.agentName}`,
      `agentRole: ${values.agentRole ?? "none"} ${sources.agentRole}`,
      `autoInject: ${String(values.autoInject)} ${sources.autoInject}`,
      `mode: ${values.mode} ${sources.mode}`,
      `path: ${CONFIG_PATH}`,
    ].join("\n"),
    "info",
  );
}

async function doctorCommand(ctx: ExtensionContext): Promise<void> {
  const config = await resolveConfig();
  const serverStatus = await getServerStatus(config.values.serverUrl);
  const serverOk = serverStatus.reachable;

  ctx.ui.notify(
    [
      "PI//LINK Doctor",
      "",
      `Config: ${config.configExists ? "OK" : "missing"}`,
      `Mode: ${config.values.mode}`,
      `Server: ${serverOk ? "OK" : "unreachable"}`,
      `Server Managed: ${serverStatus.managed ? "yes" : "no"}`,
      `Local Process: ${serverStatus.running ? "running" : "stopped"}`,
      `Server Port: ${serverStatus.port ?? "unknown"}`,
      `Agent: ${runtimeState.connected ? "connected" : "disconnected"}`,
      `SSE: ${runtimeState.sseConnected ? "connected" : "disconnected"}`,
      `Auto Inject: ${runtimeState.autoInject ? "enabled" : "disabled"}`,
      `Env Overrides: ${formatEnvOverrides()}`,
      `State: ${runtimeState.sessionId ? "initialized" : "missing"}`,
    ].join("\n"),
    serverOk ? "info" : "warning",
  );
}

async function promptText(
  ctx: ExtensionContext,
  label: string,
  current: string,
): Promise<string | undefined> {
  const value = await ctx.ui.input(label, current);
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : current;
}

function formatAgents(agents: Agent[]): string {
  if (agents.length === 0) {
    return "Connected Agents:\n\nNone";
  }

  return [
    "Connected Agents:",
    "",
    ...agents.map((agent, index) =>
      [
        `${index + 1}. ${agent.name}`,
        `   ID: ${agent.id}`,
        `   Role: ${agent.role ?? "none"}`,
        `   Status: ${agent.status}`,
      ].join("\n"),
    ),
  ].join("\n");
}

function formatInbox(messages: AgentMessage[]): string {
  if (messages.length === 0) {
    return "Inbox:\n\nNo messages.";
  }

  return [
    "Inbox:",
    "",
    ...messages.map((message) =>
      [
        `From: ${message.fromAgentId}`,
        `Message ID: ${message.id}`,
        "",
        `"${message.content}"`,
      ].join("\n"),
    ),
  ].join("\n\n");
}

function formatAgentLabel(agent: Agent): string {
  return `${agent.name} (${agent.role ?? "none"}) - ${agent.id}`;
}

function formatServerStatus(title: string, status: ServerStatus): string {
  return [
    title,
    "",
    `Reachable: ${status.reachable ? "yes" : "no"}`,
    `Managed: ${status.managed ? "yes" : "no"}`,
    `Local Process: ${status.running ? "running" : "stopped"}`,
    `Started By Extension: ${status.startedByExtension ? "yes" : "no"}`,
    `Port: ${status.port ?? "unknown"}`,
  ].join("\n");
}

function formatEnvOverrides(): string {
  const names = [
    "PI_LINK_SERVER_URL",
    "PI_LINK_AGENT_NAME",
    "PI_LINK_AGENT_ROLE",
    "PI_LINK_AUTO_INJECT",
  ];
  const active = names.filter((name) => process.env[name] !== undefined);
  return active.length > 0 ? active.join(", ") : "none";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
