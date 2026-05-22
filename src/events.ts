/**
 * PI//LINK — Server-Sent Events fanout
 *
 * Tracks live SSE clients per agent and publishes runtime events such as inbound
 * messages and host-offline notices. The server uses this module as the live
 * delivery layer only; durable delivery remains in the in-memory message store,
 * and missing live events can still be recovered through inbox reads.
 */
import type { AgentMessage, PiLinkEvent } from "./types";

interface SseClient {
  id: string;
  agentId: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  keepAlive: ReturnType<typeof setInterval>;
}

const encoder = new TextEncoder();
const clientsByAgentId = new Map<string, Map<string, SseClient>>();

/**
 * Opens an SSE stream for one agent and registers it for future event fanout.
 */
export function createEventStream(
  agentId: string,
  signal: AbortSignal,
  onClose?: (agentId: string) => void,
): Response {
  const clientId = crypto.randomUUID();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const client: SseClient = {
        id: clientId,
        agentId,
        controller,
        keepAlive: setInterval(() => {
          try {
            sendRaw(controller, ": ping\n\n");
          } catch {
            removeClientById(agentId, clientId);
          }
        }, 25_000),
      };

      addClient(client);
      sendRaw(controller, "event: connected\ndata: {}\n\n");
      signal.addEventListener(
        "abort",
        () => removeClient(client, onClose),
        { once: true },
      );
      console.log(`[pi-link] sse connected agent=${agentId} client=${clientId}`);
    },
    cancel() {
      removeClientById(agentId, clientId, onClose);
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream",
      "x-accel-buffering": "no",
    },
  });
}

/**
 * Publishes a live notification to the target agent for a newly created message.
 */
export function publishMessageCreated(message: AgentMessage): void {
  publishToAgent(message.toAgentId, {
    type: "message.created",
    message,
  });
}

/**
 * Sends one typed event to every active SSE stream for the target agent.
 */
export function publishToAgent(agentId: string, event: PiLinkEvent): void {
  const clients = clientsByAgentId.get(agentId);
  if (clients === undefined || clients.size === 0) {
    return;
  }

  const frame = formatSse(event.type, event);
  for (const client of clients.values()) {
    try {
      sendRaw(client.controller, frame);
    } catch {
      removeClient(client);
    }
  }
}

function addClient(client: SseClient): void {
  const clients = clientsByAgentId.get(client.agentId) ?? new Map<string, SseClient>();
  clients.set(client.id, client);
  clientsByAgentId.set(client.agentId, clients);
}

function removeClientById(
  agentId: string,
  clientId: string,
  onClose?: (agentId: string) => void,
): void {
  const client = clientsByAgentId.get(agentId)?.get(clientId);
  if (client !== undefined) {
    removeClient(client, onClose);
  }
}

function removeClient(client: SseClient, onClose?: (agentId: string) => void): void {
  clearInterval(client.keepAlive);

  const clients = clientsByAgentId.get(client.agentId);
  if (clients === undefined) {
    return;
  }

  clients.delete(client.id);
  if (clients.size === 0) {
    clientsByAgentId.delete(client.agentId);
    onClose?.(client.agentId);
  }

  console.log(`[pi-link] sse disconnected agent=${client.agentId} client=${client.id}`);
}

function formatSse(eventName: string, data: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sendRaw(
  controller: ReadableStreamDefaultController<Uint8Array>,
  payload: string,
): void {
  controller.enqueue(encoder.encode(payload));
}
