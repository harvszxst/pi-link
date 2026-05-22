# Delivery and Reconnect

This page explains delivery status and what happens when the SSE stream drops.

## Delivery Status

The inbox endpoint is one delivery boundary. When an agent checks its inbox, pending messages become delivered.

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

V3 adds another delivery boundary: successful session injection. After `pi.sendMessage()` succeeds, the extension calls the delivered endpoint:

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

The resulting state model is:

- `pending`: message was sent and stored.
- live SSE event: recipient's extension saw that a message exists.
- `delivered`: recipient received the message through session injection or manual inbox check.

## Reconnect Behavior

The extension runs a simple reconnect loop. If the stream drops, it waits and reconnects with capped backoff.

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
