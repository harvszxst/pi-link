/**
 * PI//LINK — Pi extension entrypoint
 *
 * Registers the PI//LINK slash command set and tool bridge inside Pi. Startup is
 * intentionally non-invasive: it only reports whether config exists and asks the
 * user to run `/pilink setup`; it does not restore old sessions or auto-register
 * an agent. Tool calls use the current runtime connection and stay scoped to the
 * active one-time network.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { registerPiLinkCommands } from "../src/extension/commands";
import { resolveConfig } from "../src/extension/config";
import { createRuntimeClient } from "../src/extension/runtime";
import { requireCurrentAgentId, runtimeState } from "../src/extension/state";

export default function piLink(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    try {
      const config = await resolveConfig();
      if (!config.configExists) {
        ctx.ui.notify("PI//LINK not configured.\nRun /pilink setup.", "info");
        return;
      }

      ctx.ui.notify(
        "PI//LINK config detected.\nRun /pilink setup to start or join a network.",
        "info",
      );
    } catch (error) {
      ctx.ui.notify(`PI//LINK startup check failed.\n${errorMessage(error)}`, "warning");
    }
  });

  registerPiLinkCommands(pi);
  registerPiLinkTools(pi);
}

function registerPiLinkTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "pi_link_list_agents",
    label: "List PI//LINK Agents",
    description: "List all online PI//LINK agents except the current agent.",
    parameters: Type.Object({}),
    async execute() {
      const client = createRuntimeClient();
      const agents = await client.listAgents(
        requireCurrentAgentId(),
        runtimeState.networkName,
      );
      return toolResult(formatJson(agents), { agents });
    },
  });

  pi.registerTool({
    name: "pi_link_send_message",
    label: "Send PI//LINK Message",
    description: "Send a message to another PI//LINK agent.",
    parameters: Type.Object({
      toAgentId: Type.String({
        description: "The target PI//LINK agent ID.",
      }),
      content: Type.String({
        description: "The message content to send.",
      }),
    }),
    async execute(_toolCallId, params) {
      const client = createRuntimeClient();
      const body = asStringParams(params);
      const message = await client.sendMessage({
        fromAgentId: requireCurrentAgentId(),
        toAgentId: requireStringParam(body, "toAgentId"),
        content: requireStringParam(body, "content"),
      });

      return toolResult(formatJson(message), { message });
    },
  });

  pi.registerTool({
    name: "pi_link_check_inbox",
    label: "Check PI//LINK Inbox",
    description: "Check incoming PI//LINK messages for the current agent.",
    parameters: Type.Object({}),
    async execute() {
      const client = createRuntimeClient();
      const messages = await client.getInbox(requireCurrentAgentId());
      return toolResult(formatJson(messages), { messages });
    },
  });

  pi.registerTool({
    name: "pi_link_reply",
    label: "Reply via PI//LINK",
    description: "Reply to an existing PI//LINK message.",
    parameters: Type.Object({
      messageId: Type.String({
        description: "The message ID to reply to.",
      }),
      content: Type.String({
        description: "The reply content.",
      }),
    }),
    async execute(_toolCallId, params) {
      const client = createRuntimeClient();
      const body = asStringParams(params);
      const message = await client.replyToMessage(
        requireStringParam(body, "messageId"),
        {
          fromAgentId: requireCurrentAgentId(),
          content: requireStringParam(body, "content"),
        },
      );

      return toolResult(formatJson(message), { message });
    },
  });

  pi.registerTool({
    name: "pi_link_heartbeat",
    label: "PI//LINK Heartbeat",
    description: "Refresh the current PI//LINK agent last-seen timestamp.",
    parameters: Type.Object({}),
    async execute() {
      const client = createRuntimeClient();
      const agent = await client.heartbeat(requireCurrentAgentId());
      return toolResult(formatJson(agent), { agent });
    },
  });
}

function asStringParams(params: unknown): Record<string, string> {
  if (typeof params !== "object" || params === null) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      output[key] = value;
    }
  }

  return output;
}

function requireStringParam(params: Record<string, string>, key: string): string {
  const value = params[key];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

function toolResult(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
