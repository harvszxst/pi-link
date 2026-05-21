# Core Functionality

This document explains the main PI//LINK code paths. It focuses on the learning pieces: how agents register, how messages are stored, how SSE live notifications work, and why reading a message is still manual in V2.

## Agent Registration

Pi loads the extension and fires `session_start`. The extension reads local environment variables, registers with the server, and stores the returned agent ID in memory.

```ts
const response = await requestJson<{ agent: Agent }>("/agents/register", {
  method: "POST",
  body: {
    name: readEnv("PI_LINK_AGENT_NAME", DEFAULT_AGENT_NAME),
    role: readEnv("PI_LINK_AGENT_ROLE", DEFAULT_AGENT_ROLE),
    sessionId: state.sessionId,
  },
});
```

The store uses `sessionId` as the stable identity for a running Pi session. If the same session registers again, PI//LINK updates that agent instead of creating a duplicate.

```ts
const existingId = this.agentsBySessionId.get(input.sessionId);
```

That gives a simple local lifecycle: restart the extension process and it gets a new session ID; re-register within the same process and it refreshes the existing agent.

## Message Creation

Sending a message is a normal JSON HTTP request. The extension includes the current agent ID, the target agent ID, and the content.

```ts
await requestJson<{ message: AgentMessage }>("/messages", {
  method: "POST",
  body: {
    fromAgentId: currentAgentId,
    toAgentId,
    content,
  },
});
```

The store verifies that both agents exist, creates an in-memory message, and starts it as `pending`.

```ts
const message: AgentMessage = {
  id: createId("msg"),
  fromAgentId: input.fromAgentId,
  toAgentId: input.toAgentId,
  content: input.content,
  status: "pending",
  createdAt: nowIso(),
};
```

V2 then publishes a live notification after the message is stored.

```ts
const message = store.createMessage(input);
publishMessageCreated(message);
```

The publish step is deliberately outside the store. The store only owns data. The event hub owns live delivery.

## SSE Live Notifications

Each Pi extension connects to its own event stream after registration:

```ts
fetch(`${state.serverUrl}/events/${encodeURIComponent(agentId)}`, { signal });
```

The server returns a `text/event-stream` response and keeps the connection open:

```ts
return new Response(stream, {
  headers: {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  },
});
```

The event hub stores active streams by target agent ID. When a message is created, only the message target receives the event.

```ts
publishToAgent(message.toAgentId, {
  type: "message.created",
  message,
});
```

The extension parses SSE frames from the streaming response. When it sees `message.created`, it notifies the user:

```ts
ctx.ui.notify(
  `PI//LINK message from ${event.message.fromAgentId}. Check inbox to read it.`,
  "info",
);
```

This is the key V2 behavior: live awareness without automatic session injection.

## Why SSE Does Not Mark Delivered

SSE only says, "a message exists." It does not mean the agent has read it.

The inbox endpoint is still the read boundary:

```ts
if (message.status === "pending") {
  const delivered: AgentMessage = {
    ...message,
    status: "delivered",
    deliveredAt: now,
  };
  this.messagesById.set(message.id, delivered);
}
```

That separation keeps the state easy to reason about:

- `pending`: message was sent and stored.
- live SSE event: recipient was notified.
- `delivered`: recipient checked inbox and received the message payload.

V3 can build on this by injecting inbound messages into the Pi session with `pi.sendMessage()`, but V2 intentionally avoids that.

## Reconnect Behavior

The extension runs a simple reconnect loop. If the stream drops, it waits and reconnects with a capped backoff.

```ts
while (!signal.aborted) {
  try {
    await connectEventStream(agentId, ctx, signal);
    reconnectDelayMs = 1_000;
  } catch {
    await sleep(reconnectDelayMs, signal);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 10_000);
  }
}
```

There is no missed-event replay in V2. If a live event is missed during reconnect, the message is still safely stored and will appear when the agent checks its inbox.

## Manual Workflow

V2 keeps the workflow explicit:

1. Agent A sends a message.
2. Server stores the message as `pending`.
3. Server pushes an SSE notification to Agent B.
4. Agent B manually checks inbox.
5. Server marks the message `delivered`.
6. Agent B can reply.

This keeps PI//LINK small while making live communication visible.

