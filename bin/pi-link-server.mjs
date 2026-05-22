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
  hostOffline: "HOST_OFFLINE",
  messageNotFound: "MESSAGE_NOT_FOUND",
  networkMismatch: "NETWORK_MISMATCH",
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
    const networkName = url.searchParams.get("network") ?? undefined;
    return jsonResponse({ agents: listAgents(excludeAgentId, networkName) });
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
        networkName: input.networkName,
        networkRole: input.networkRole,
        status: "online",
        lastSeenAt: now,
      };
      if (input.role === undefined) {
        delete updated.role;
      } else {
        updated.role = input.role;
      }
      store.agents.set(updated.id, updated);
      markDuplicateAgentsOffline(input, updated.id);
      return updated;
    }
  }

  markDuplicateAgentsOffline(input);

  const agent = {
    id: `agent_${randomUUID()}`,
    name: input.name,
    networkName: input.networkName,
    networkRole: input.networkRole,
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

function markDuplicateAgentsOffline(input, excludeAgentId) {
  const now = new Date().toISOString();

  for (const agent of store.agents.values()) {
    if (
      agent.id === excludeAgentId ||
      agent.networkName !== input.networkName ||
      agent.name !== input.name ||
      agent.status === "offline"
    ) {
      continue;
    }

    store.agents.set(agent.id, {
      ...agent,
      status: "offline",
      lastSeenAt: now,
    });
  }
}

function listAgents(excludeAgentId, networkName) {
  return Array.from(store.agents.values()).filter(
    (agent) =>
      agent.status === "online" &&
      agent.id !== excludeAgentId &&
      (networkName === undefined || agent.networkName === networkName),
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
  assertSameNetwork(input.fromAgentId, input.toAgentId);
  assertNetworkHostOnline(input.fromAgentId);

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

function assertNetworkHostOnline(senderAgentId) {
  const sender = store.agents.get(senderAgentId);
  if (sender === undefined || sender.networkRole === "host") {
    return;
  }

  const hostOnline = Array.from(store.agents.values()).some((agent) => {
    return (
      agent.networkName === sender.networkName &&
      agent.networkRole === "host" &&
      agent.status === "online"
    );
  });

  if (!hostOnline) {
    throw new RequestError(
      ERROR_CODES.hostOffline,
      "Network host is offline. This network is no longer available.",
      409,
    );
  }
}

function assertSameNetwork(fromAgentId, toAgentId) {
  const fromAgent = store.agents.get(fromAgentId);
  const toAgent = store.agents.get(toAgentId);

  if (
    fromAgent === undefined ||
    toAgent === undefined ||
    fromAgent.networkName === toAgent.networkName
  ) {
    return;
  }

  throw new RequestError(
    ERROR_CODES.networkMismatch,
    "Target agent is not in the current network.",
    409,
  );
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

function markAgentOffline(agentId) {
  const agent = store.agents.get(agentId);
  if (agent === undefined || agent.status === "offline") {
    return null;
  }

  const offline = {
    ...agent,
    status: "offline",
    lastSeenAt: new Date().toISOString(),
  };
  store.agents.set(agentId, offline);

  if (offline.networkRole !== "host") {
    return null;
  }

  const recipientAgentIds = Array.from(store.agents.values())
    .filter((candidate) => {
      return (
        candidate.networkName === offline.networkName &&
        candidate.networkRole === "member" &&
        candidate.status === "online"
      );
    })
    .map((candidate) => candidate.id);

  return {
    event: {
      type: "network.host.offline",
      networkName: offline.networkName,
      hostAgentId: offline.id,
      hostName: offline.name,
    },
    recipientAgentIds,
  };
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
  publishToAgent(message.toAgentId, { type: "message.created", message });
}

function publishToAgent(agentId, event) {
  const clients = eventClients.get(agentId);
  if (clients === undefined) {
    return;
  }

  const payload = JSON.stringify(event);
  for (const controller of clients) {
    controller.enqueue(`event: ${event.type}\ndata: ${payload}\n\n`);
  }
}

function createEventStream(agentId, signal) {
  let activeController;
  let activeClients;

  function closeStream(controller, clients) {
    if (!clients.has(controller)) {
      return;
    }

    clients.delete(controller);
    if (clients.size === 0) {
      eventClients.delete(agentId);
      handleAgentEventStreamClosed(agentId);
    }
    console.log(`[pi-link] sse disconnected agent=${agentId}`);
    activeController = undefined;
    activeClients = undefined;
  }

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
      activeController = textController;
      activeClients = clients;
      textController.enqueue("event: connected\ndata: {}\n\n");
      console.log(`[pi-link] sse connected agent=${agentId}`);

      signal.addEventListener(
        "abort",
        () => {
          closeStream(textController, clients);
          controller.close();
        },
        { once: true },
      );
    },
    cancel() {
      if (activeController !== undefined && activeClients !== undefined) {
        closeStream(activeController, activeClients);
      }
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

function handleAgentEventStreamClosed(agentId) {
  const result = markAgentOffline(agentId);
  if (result === null) {
    return;
  }

  for (const recipientAgentId of result.recipientAgentIds) {
    publishToAgent(recipientAgentId, result.event);
  }
}

async function parseRegisterAgentInput(request) {
  const body = await readJsonBody(request);
  const name = readString(body, "name");
  const sessionId = readString(body, "sessionId");
  const networkName = readString(body, "networkName");
  const networkRole = readNetworkRole(body);
  const role = readOptionalString(body, "role");

  if (name === null || sessionId === null || networkName === null) {
    throw new RequestError(
      ERROR_CODES.invalidRequest,
      "name, sessionId, and networkName are required.",
      400,
    );
  }

  if (networkRole === null) {
    throw new RequestError(
      ERROR_CODES.invalidRequest,
      "networkRole must be host or member.",
      400,
    );
  }

  return role === undefined
    ? { name, sessionId, networkName, networkRole }
    : { name, sessionId, networkName, networkRole, role };
}

function readNetworkRole(body) {
  const value = readString(body, "networkRole");
  return value === "host" || value === "member" ? value : null;
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
  const abortController = new AbortController();
  incoming.on("close", () => abortController.abort());

  return new Request(url, {
    method: incoming.method,
    headers: incoming.headers,
    body: incoming.method === "GET" || incoming.method === "HEAD" ? undefined : incoming,
    duplex: "half",
    signal: abortController.signal,
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
