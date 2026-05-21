import { ERROR_CODES, SERVICE_NAME, VERSION } from "./constants";
import { StoreError, store } from "./store";
import type {
  CreateMessageInput,
  RegisterAgentInput,
  ReplyToMessageInput,
} from "./types";
import {
  isRecord,
  jsonError,
  jsonResponse,
  readOptionalString,
  readString,
} from "./utils";

export async function handleRequest(request: Request): Promise<Response> {
  try {
    return await routeRequest(request);
  } catch (error) {
    if (error instanceof StoreError) {
      return storeErrorResponse(error);
    }

    console.error(error);
    return jsonError(
      ERROR_CODES.serverError,
      "Unexpected server error.",
      500,
    );
  }
}

async function routeRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({
      ok: true,
      service: SERVICE_NAME,
      version: VERSION,
    });
  }

  if (request.method === "POST" && url.pathname === "/agents/register") {
    const input = await parseRegisterAgentInput(request);
    const agent = store.registerAgent(input);
    console.log(
      `[pi-link] registered agent ${agent.id} name=${agent.name} role=${agent.role ?? "none"} session=${agent.sessionId}`,
    );
    return jsonResponse({ agent });
  }

  if (request.method === "GET" && url.pathname === "/agents") {
    const excludeAgentId = url.searchParams.get("exclude") ?? undefined;
    const agents = store.listAgents(excludeAgentId);
    return jsonResponse({ agents });
  }

  if (
    request.method === "POST" &&
    pathParts.length === 3 &&
    pathParts[0] === "agents" &&
    pathParts[2] === "heartbeat"
  ) {
    const agentId = pathParts[1];
    if (agentId === undefined || agentId.length === 0) {
      return jsonError(ERROR_CODES.invalidRequest, "Agent ID is required.", 400);
    }

    const agent = store.touchAgent(agentId);
    if (agent === null) {
      return jsonError(ERROR_CODES.agentNotFound, "Agent does not exist.", 404);
    }

    console.log(`[pi-link] heartbeat agent ${agent.id} name=${agent.name}`);
    return jsonResponse({ agent });
  }

  if (request.method === "POST" && url.pathname === "/messages") {
    const input = await parseCreateMessageInput(request);
    const message = store.createMessage(input);
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
    const agentId = pathParts[2];
    if (agentId === undefined || agentId.length === 0) {
      return jsonError(ERROR_CODES.invalidRequest, "Agent ID is required.", 400);
    }

    const messages = store.getInbox(agentId);
    console.log(`[pi-link] inbox agent=${agentId} messages=${messages.length}`);
    return jsonResponse({ messages });
  }

  if (
    request.method === "POST" &&
    pathParts.length === 3 &&
    pathParts[0] === "messages" &&
    pathParts[2] === "reply"
  ) {
    const messageId = pathParts[1];
    if (messageId === undefined || messageId.length === 0) {
      return jsonError(ERROR_CODES.invalidRequest, "Message ID is required.", 400);
    }

    const input = await parseReplyToMessageInput(request);
    const message = store.replyToMessage(messageId, input);
    console.log(
      `[pi-link] reply ${message.id} replyTo=${message.replyToMessageId ?? messageId} from=${message.fromAgentId} to=${message.toAgentId}`,
    );
    return jsonResponse({ message });
  }

  return jsonError(ERROR_CODES.invalidRequest, "Route not found.", 404);
}

async function parseRegisterAgentInput(
  request: Request,
): Promise<RegisterAgentInput> {
  const body = await readJsonBody(request);
  const name = readString(body, "name");
  const sessionId = readString(body, "sessionId");
  const role = readOptionalString(body, "role");

  if (name === null || sessionId === null) {
    throwInvalidRequest("name and sessionId are required.");
  }

  const input: RegisterAgentInput = {
    name,
    sessionId,
  };

  if (role !== undefined) {
    input.role = role;
  }

  return input;
}

async function parseCreateMessageInput(
  request: Request,
): Promise<CreateMessageInput> {
  const body = await readJsonBody(request);
  const fromAgentId = readString(body, "fromAgentId");
  const toAgentId = readString(body, "toAgentId");
  const content = readString(body, "content");

  if (fromAgentId === null || toAgentId === null || content === null) {
    throwInvalidRequest("fromAgentId, toAgentId, and content are required.");
  }

  return {
    fromAgentId,
    toAgentId,
    content,
  };
}

async function parseReplyToMessageInput(
  request: Request,
): Promise<ReplyToMessageInput> {
  const body = await readJsonBody(request);
  const fromAgentId = readString(body, "fromAgentId");
  const content = readString(body, "content");

  if (fromAgentId === null || content === null) {
    throwInvalidRequest("fromAgentId and content are required.");
  }

  return {
    fromAgentId,
    content,
  };
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throwInvalidRequest("Request body must be valid JSON.");
  }

  if (!isRecord(body)) {
    throwInvalidRequest("Request body must be a JSON object.");
  }

  return body;
}

function throwInvalidRequest(message: string): never {
  throw new StoreError(ERROR_CODES.invalidRequest, message);
}

function storeErrorResponse(error: StoreError): Response {
  switch (error.code) {
    case ERROR_CODES.invalidRequest:
      return jsonError(error.code, error.message, 400);
    case ERROR_CODES.agentNotFound:
    case ERROR_CODES.messageNotFound:
      return jsonError(error.code, error.message, 404);
    case ERROR_CODES.serverError:
      return jsonError(error.code, error.message, 500);
  }
}
