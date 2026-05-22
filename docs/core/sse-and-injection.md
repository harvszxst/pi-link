# SSE and Injection

This page explains live delivery: how the server pushes message events and how the extension injects inbound messages into Pi.

## Event Stream

Each Pi extension opens its own event stream after registration:

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

The event hub stores active streams by target agent ID. When a message is created, only the target receives the event.

```ts
publishToAgent(message.toAgentId, {
  type: "message.created",
  message,
});
```

## SSE Parsing

The extension reads SSE frames from the stream and handles `message.created` events:

```ts
const parsed = parseEventFrame(frame);
if (parsed === null || parsed.event !== "message.created") {
  return;
}
```

The frame data is JSON, so the extension decodes it before deciding whether to inject or notify.

```ts
const event = parseMessageCreatedEvent(parsed.data);
```

## Pi Session Injection

When auto-inject is enabled, V3 inserts the inbound message into the active Pi session:

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
