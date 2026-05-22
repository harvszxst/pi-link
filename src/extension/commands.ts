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
import type { PiLinkConfig, PiLinkMode, PiLinkNetworkAction } from "./types";

const HELP_TEXT = [
  "PI//LINK commands:",
  "/pilink setup",
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
        await setupCommand(pi, ctx);
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

async function setupCommand(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
  const resolved = await resolveConfig();
  const current = resolved.values;

  const mode = await promptMode(ctx, current.mode);
  if (mode === undefined) {
    return;
  }

  if (mode === "remote") {
    ctx.ui.notify(
      "Remote mode is coming soon. This will set up a hosted PI//LINK server and share it over Tailscale in a future release.",
      "info",
    );
    return;
  }

  let serverUrl = current.serverUrl;
  if (mode === "local") {
    serverUrl = "http://127.0.0.1:3007";
  } else {
    ctx.ui.notify(
      "LAN mode is intended only for trusted local networks.\nDo not expose PI//LINK to the public internet.",
      "warning",
    );
    const lanServerUrl = await promptText(ctx, "Server URL", current.serverUrl);
    if (lanServerUrl === undefined) {
      return;
    }
    serverUrl = lanServerUrl;
  }

  const networkAction = await promptNetworkAction(ctx, current.networkAction);
  if (networkAction === undefined) {
    return;
  }

  const networkName = await promptText(ctx, "Network name", current.networkName);
  if (networkName === undefined) {
    return;
  }

  const agentName = await promptText(ctx, "Agent name", current.agentName);
  if (agentName === undefined) {
    return;
  }

  const agentRole = await promptText(ctx, "Agent role", current.agentRole ?? "");
  if (agentRole === undefined) {
    return;
  }

  const autoInjectChoice = await ctx.ui.select(
    "Auto inject?",
    current.autoInject ? ["yes", "no"] : ["no", "yes"],
  );
  if (autoInjectChoice === undefined) {
    return;
  }

  const config: PiLinkConfig = {
    serverUrl,
    agentName,
    autoInject: autoInjectChoice === "yes",
    mode,
    networkAction,
    networkName,
  };

  if (agentRole.trim().length > 0) {
    config.agentRole = agentRole;
  }

  await saveConfig(config);
  applyRuntimeConfig(config);
  const result = await connectPiLink(pi, ctx);
  ctx.ui.notify(
    [
      `PI//LINK config saved:\n${CONFIG_PATH}`,
      "",
      formatConnectedSummary(result.config.values),
    ].join("\n"),
    "info",
  );
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
      `Network: ${runtimeState.networkName}`,
      `Network Action: ${runtimeState.networkAction}`,
      `Auto Inject: ${runtimeState.autoInject ? "enabled" : "disabled"}`,
      `SSE: ${runtimeState.sseConnected ? "connected" : "disconnected"}`,
      `Heartbeat: ${runtimeState.heartbeatRunning ? "running" : "stopped"}`,
    ].join("\n"),
    "info",
  );
}

async function agentsCommand(ctx: ExtensionContext): Promise<void> {
  const client = createRuntimeClient();
  const agents = await client.listAgents(
    requireCurrentAgentId(),
    runtimeState.networkName,
  );

  ctx.ui.notify(formatAgents(agents), "info");
}

async function sendCommand(ctx: ExtensionContext): Promise<void> {
  const client = createRuntimeClient();
  const fromAgentId = requireCurrentAgentId();
  const agents = await client.listAgents(fromAgentId, runtimeState.networkName);
  if (
    runtimeState.networkAction === "join" &&
    !agents.some((agent) => agent.networkRole === "host")
  ) {
    ctx.ui.notify(formatHostOfflineNotice(), "warning");
    return;
  }

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
      `networkAction: ${values.networkAction} ${sources.networkAction}`,
      `networkName: ${values.networkName} ${sources.networkName}`,
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
      `Network: ${config.values.networkName}`,
      `Network Action: ${config.values.networkAction}`,
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

async function promptMode(
  ctx: ExtensionContext,
  current: PiLinkMode,
): Promise<PiLinkMode | undefined> {
  const choices = orderChoices(current, ["local", "lan", "remote"]);
  const selected = await ctx.ui.select("Mode?", choices);
  return selected as PiLinkMode | undefined;
}

async function promptNetworkAction(
  ctx: ExtensionContext,
  current: PiLinkNetworkAction,
): Promise<PiLinkNetworkAction | undefined> {
  const labels: Record<PiLinkNetworkAction, string> = {
    create: "create network",
    join: "join network",
  };
  const choices = orderChoices(labels[current], [
    labels.create,
    labels.join,
  ]);
  const selected = await ctx.ui.select("Network?", choices);

  if (selected === labels.create) {
    return "create";
  }

  if (selected === labels.join) {
    return "join";
  }

  return undefined;
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

function orderChoices<T extends string>(current: T, choices: T[]): T[] {
  return [
    current,
    ...choices.filter((choice) => choice !== current),
  ];
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

function formatHostOfflineNotice(): string {
  return [
    "Cannot send message.",
    "Network host is offline.",
    "This network is no longer available.",
    "",
    "Run /pilink setup to start or join a new PI//LINK network.",
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
