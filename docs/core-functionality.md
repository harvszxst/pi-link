# Core Functionality

This document explains the main PI//LINK code paths. It focuses on the learning pieces: how agents register, how messages are stored, how SSE live delivery works, and how V3 injects inbound messages into a Pi session.

## Agent Registration

Pi loads the extension and fires `session_start`. The extension resolves config from environment variables, `~/.pi-link/config.json`, and defaults. It then registers with the server and stores the returned agent ID in runtime state.

```ts
const config = await resolveConfig();
const agent = await client.registerAgent({
  name: config.values.agentName,
  role: config.values.agentRole,
  sessionId: runtimeState.sessionId,
});
```

The store uses `sessionId` as the stable identity for a running Pi session. If the same session registers again, PI//LINK updates that agent instead of creating a duplicate.

```ts
const existingId = this.agentsBySessionId.get(input.sessionId);
```

That gives a simple local lifecycle: restart the extension process and it gets a new session ID; re-register within the same process and it refreshes the existing agent.

## Pi-Native Commands

PI//LINK exposes one Pi slash command with subcommands:

```txt
/pilink setup
/pilink connect
/pilink agents
/pilink send
```

The command layer is separate from the server client. Commands handle user interaction with `ctx.ui.input`, `ctx.ui.select`, and `ctx.ui.notify`; the client module handles HTTP calls. This keeps the installed extension flow close to normal Pi usage:

```bash
pi
```

Then configure and operate PI//LINK from inside Pi.

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

The route publishes a live event after the message is stored.

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

The extension parses SSE frames from the streaming response. When it sees `message.created`, V3 injects the message into the active Pi session:

```ts
pi.sendMessage(
  {
    customType: "pi-link-message",
    content: formatInboundMessage(message),
    display: true,
    details: { message },
  },
  { triggerTurn: false },
);
```

This is the key V3 behavior: the user can see the inbound peer message immediately, but the receiving agent does not automatically start a turn.

Set `PI_LINK_AUTO_INJECT=false` to keep V2 behavior. In that mode, the extension only shows a UI notification and the agent can manually check inbox.

## Delivery Status

In V1 and V2, the inbox endpoint was the only delivery boundary:

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

V3 adds a second delivery boundary: successful injection. After `pi.sendMessage()` succeeds, the extension calls the delivered endpoint:

```ts
await requestJson<{ message: AgentMessage }>(
  `/messages/${encodeURIComponent(messageId)}/delivered`,
  { method: "POST" },
);
```

The store handles this idempotently:

```ts
if (message.status !== "pending") {
  return message;
}
```

That keeps the state easy to reason about:

- `pending`: message was sent and stored.
- live SSE event: recipient's extension saw that a message exists.
- `delivered`: recipient received the message through session injection or manual inbox check.

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

There is no missed-event replay. If a live event is missed during reconnect, the message is still safely stored and will appear when the agent checks its inbox.

## Manual Workflow

V3 keeps the workflow visible without making agents autonomous:

1. Agent A sends a message.
2. Server stores the message as `pending`.
3. Server pushes an SSE notification to Agent B.
4. Agent B extension injects the message with `pi.sendMessage()`.
5. Extension marks the message `delivered`.
6. Agent B can reply when prompted or instructed.

This keeps PI//LINK small while making peer communication visible inside the session.
