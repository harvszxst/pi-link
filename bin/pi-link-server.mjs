#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const SERVICE_NAME = "pi-link";
const VERSION = "0.3.0";
const DEFAULT_HOSTNAME = "127.0.0.1";
const DEFAULT_PORT = 3007;

const ERROR_CODES = {
  invalidRequest: "INVALID_REQUEST",
  agentNotFound: "AGENT_NOT_FOUND",
  messageNotFound: "MESSAGE_NOT_FOUND",
  serverError: "SERVER_ERROR",
};

const store = {
  agents: new Map(),
  messages: new Map(),
  sessionAgents: new Map(),
};

const eventClients = new Map();

const hostname = process.env.PI_LINK_HOST ?? DEFAULT_HOSTNAME;
const port = Number(process.env.PI_LINK_PORT ?? DEFAULT_PORT);

const server = createServer(async (incoming, outgoing) => {
  try {
    const request = toWebRequest(incoming);
    const response = await routeRequest(request);
    await writeWebResponse(outgoing, response);
  } catch (error) {
    if (error instanceof RequestError) {
      await writeWebResponse(outgoing, jsonError(error.code, error.message, error.status));
      return;
    }

    console.error(error);
    await writeWebResponse(
      outgoing,
      jsonError(ERROR_CODES.serverError, "Unexpected server error.", 500),
    );
  }
});

server.listen(port, hostname, () => {
  console.log(`${SERVICE_NAME} ${VERSION} listening on http://${hostname}:${port}`);
});

async function routeRequest(request) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({ ok: true, service: SERVICE_NAME, version: VERSION });
  }

  if (request.method === "POST" && url.pathname === "/agents/register") {
    const input = await parseRegisterAgentInput(request);
    const agent = registerAgent(input);
    console.log(
      `[pi-link] registered agent ${agent.id} name=${agent.name} role=${agent.role ?? "none"} session=${agent.sessionId}`,
    );
    return jsonResponse({ agent });
  }

  if (request.method === "GET" && url.pathname === "/agents") {
    const excludeAgentId = url.searchParams.get("exclude") ?? undefined;
    return jsonResponse({ agents: listAgents(excludeAgentId) });
  }

  if (
    request.method === "GET" &&
    pathParts.length === 2 &&
    pathParts[0] === "events"
  ) {
    const agentId = pathParts[1];
    if (!agentId) {
      return jsonError(ERROR_CODES.invalidRequest, "Agent ID is required.", 400);
    }

    if (!store.agents.has(agentId)) {
      return jsonError(ERROR_CODES.agentNotFound, "Agent does not exist.", 404);
    }

    return createEventStream(agentId, request.signal);
  }

  if (
    request.method === "POST" &&
    pathParts.length === 3 &&
    pathParts[0] === "agents" &&
    pathParts[2] === "heartbeat"
  ) {
    const agent = touchAgent(pathParts[1]);
    if (agent === null) {
      return jsonError(ERROR_CODES.agentNotFound, "Agent does not exist.", 404);
    }

    console.log(`[pi-link] heartbeat agent ${agent.id} name=${agent.name}`);
    return jsonResponse({ agent });
  }

  if (request.method === "POST" && url.pathname === "/messages") {
    const input = await parseCreateMessageInput(request);
    const message = createMessage(input);
    publishMessageCreated(message);
    console.log(
      `[pi-link] message ${message.id} from=${message.fromAgentId} to=${message.toAgentId}`,
    );
    return jsonResponse({ message });
  }

  if (
    request.method === "GET" &&
    pathParts.length === 3 &&
    pathParts[0] === "messages" &&
    pathParts[1] === "inbox"
  ) {
    const messages = getInbox(pathParts[2]);
    console.log(`[pi-link] inbox agent=${pathParts[2]} messages=${messages.length}`);
    return jsonResponse({ messages });
  }

  if (
    request.method === "POST" &&
    pathParts.length === 3 &&
    pathParts[0] === "messages" &&
    pathParts[2] === "delivered"
  ) {
    const message = markMessageDelivered(pathParts[1]);
    if (message === null) {
      return jsonError(ERROR_CODES.messageNotFound, "Message does not exist.", 404);
    }

    console.log(`[pi-link] delivered message=${message.id} to=${message.toAgentId}`);
    return jsonResponse({ message });
  }

  if (
    request.method === "POST" &&
    pathParts.length === 3 &&
    pathParts[0] === "messages" &&
    pathParts[2] === "reply"
  ) {
    const input = await parseReplyToMessageInput(request);
    const message = replyToMessage(pathParts[1], input);
    if (message === null) {
      return jsonError(ERROR_CODES.messageNotFound, "Message does not exist.", 404);
    }

    publishMessageCreated(message);
    console.log(
      `[pi-link] reply ${message.id} replyTo=${message.replyToMessageId ?? pathParts[1]} from=${message.fromAgentId} to=${message.toAgentId}`,
    );
    return jsonResponse({ message });
  }

  return jsonError(ERROR_CODES.invalidRequest, "Route not found.", 404);
}

function registerAgent(input) {
  const existingId = store.sessionAgents.get(input.sessionId);
  const now = new Date().toISOString();

  if (existingId !== undefined) {
    const existing = store.agents.get(existingId);
    if (existing !== undefined) {
      const updated = {
        ...existing,
        name: input.name,
        status: "online",
        lastSeenAt: now,
      };
      if (input.role === undefined) {
        delete updated.role;
      } else {
        updated.role = input.role;
      }
      store.agents.set(updated.id, updated);
      return updated;
    }
  }

  const agent = {
    id: `agent_${randomUUID()}`,
    name: input.name,
    sessionId: input.sessionId,
    status: "online",
    createdAt: now,
    lastSeenAt: now,
  };
  if (input.role !== undefined) {
    agent.role = input.role;
  }
  store.agents.set(agent.id, agent);
  store.sessionAgents.set(agent.sessionId, agent.id);
  return agent;
}

function listAgents(excludeAgentId) {
  return Array.from(store.agents.values()).filter(
    (agent) => agent.status === "online" && agent.id !== excludeAgentId,
  );
}

function touchAgent(agentId) {
  const agent = store.agents.get(agentId);
  if (agent === undefined) {
    return null;
  }

  const updated = { ...agent, status: "online", lastSeenAt: new Date().toISOString() };
  store.agents.set(agentId, updated);
  return updated;
}

function createMessage(input) {
  if (!store.agents.has(input.fromAgentId) || !store.agents.has(input.toAgentId)) {
    throw new RequestError(ERROR_CODES.agentNotFound, "Agent does not exist.", 404);
  }

  const now = new Date().toISOString();
  const message = {
    id: `msg_${randomUUID()}`,
    fromAgentId: input.fromAgentId,
    toAgentId: input.toAgentId,
    content: input.content,
    status: "pending",
    createdAt: now,
  };
  if (input.replyToMessageId !== undefined) {
    message.replyToMessageId = input.replyToMessageId;
  }
  store.messages.set(message.id, message);
  return message;
}

function getInbox(agentId) {
  if (!store.agents.has(agentId)) {
    throw new RequestError(ERROR_CODES.agentNotFound, "Agent does not exist.", 404);
  }

  const now = new Date().toISOString();
  const messages = Array.from(store.messages.values()).filter(
    (message) => message.toAgentId === agentId,
  );

  for (const message of messages) {
    if (message.status === "pending") {
      store.messages.set(message.id, {
        ...message,
        status: "delivered",
        deliveredAt: now,
      });
    }
  }

  return messages.map((message) => store.messages.get(message.id) ?? message);
}

function markMessageDelivered(messageId) {
  const message = store.messages.get(messageId);
  if (message === undefined) {
    return null;
  }

  if (message.status !== "pending") {
    return message;
  }

  const updated = {
    ...message,
    status: "delivered",
    deliveredAt: new Date().toISOString(),
  };
  store.messages.set(messageId, updated);
  return updated;
}

function replyToMessage(messageId, input) {
  const original = store.messages.get(messageId);
  if (original === undefined) {
    return null;
  }

  return createMessage({
    fromAgentId: input.fromAgentId,
    toAgentId: original.fromAgentId,
    content: input.content,
    replyToMessageId: original.id,
  });
}

function publishMessageCreated(message) {
  const clients = eventClients.get(message.toAgentId);
  if (clients === undefined) {
    return;
  }

  const payload = JSON.stringify({ type: "message.created", message });
  for (const controller of clients) {
    controller.enqueue(`event: message.created\ndata: ${payload}\n\n`);
  }
}

function createEventStream(agentId, signal) {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const textController = {
        enqueue(value) {
          controller.enqueue(encoder.encode(value));
        },
      };

      const clients = eventClients.get(agentId) ?? new Set();
      clients.add(textController);
      eventClients.set(agentId, clients);
      textController.enqueue("event: connected\ndata: {}\n\n");
      console.log(`[pi-link] sse connected agent=${agentId}`);

      signal.addEventListener(
        "abort",
        () => {
          clients.delete(textController);
          if (clients.size === 0) {
            eventClients.delete(agentId);
          }
          controller.close();
          console.log(`[pi-link] sse disconnected agent=${agentId}`);
        },
        { once: true },
      );
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

async function parseRegisterAgentInput(request) {
  const body = await readJsonBody(request);
  const name = readString(body, "name");
  const sessionId = readString(body, "sessionId");
  const role = readOptionalString(body, "role");

  if (name === null || sessionId === null) {
    throw new RequestError(
      ERROR_CODES.invalidRequest,
      "name and sessionId are required.",
      400,
    );
  }

  return role === undefined ? { name, sessionId } : { name, sessionId, role };
}

async function parseCreateMessageInput(request) {
  const body = await readJsonBody(request);
  const fromAgentId = readString(body, "fromAgentId");
  const toAgentId = readString(body, "toAgentId");
  const content = readString(body, "content");

  if (fromAgentId === null || toAgentId === null || content === null) {
    throw new RequestError(
      ERROR_CODES.invalidRequest,
      "fromAgentId, toAgentId, and content are required.",
      400,
    );
  }

  return { fromAgentId, toAgentId, content };
}

async function parseReplyToMessageInput(request) {
  const body = await readJsonBody(request);
  const fromAgentId = readString(body, "fromAgentId");
  const content = readString(body, "content");

  if (fromAgentId === null || content === null) {
    throw new RequestError(
      ERROR_CODES.invalidRequest,
      "fromAgentId and content are required.",
      400,
    );
  }

  return { fromAgentId, content };
}

async function readJsonBody(request) {
  try {
    const body = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new Error("not an object");
    }
    return body;
  } catch {
    throw new RequestError(
      ERROR_CODES.invalidRequest,
      "Request body must be a JSON object.",
      400,
    );
  }
}

function readString(body, key) {
  const value = body[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readOptionalString(body, key) {
  const value = body[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function jsonError(code, message, status) {
  return jsonResponse({ error: { code, message } }, status);
}

function toWebRequest(incoming) {
  const protocol = incoming.socket.encrypted ? "https" : "http";
  const host = incoming.headers.host ?? `${hostname}:${port}`;
  const url = `${protocol}://${host}${incoming.url ?? "/"}`;
  return new Request(url, {
    method: incoming.method,
    headers: incoming.headers,
    body: incoming.method === "GET" || incoming.method === "HEAD" ? undefined : incoming,
    duplex: "half",
  });
}

async function writeWebResponse(outgoing, response) {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, key) => outgoing.setHeader(key, value));

  if (response.body === null) {
    outgoing.end();
    return;
  }

  for await (const chunk of response.body) {
    outgoing.write(Buffer.from(chunk));
  }
  outgoing.end();
}

class RequestError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

process.on("uncaughtException", async (error) => {
  if (error instanceof RequestError) {
    return;
  }
  console.error(error);
});
