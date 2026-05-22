# Messages and Store

This page traces a normal outgoing PI//LINK message from extension tool to in-memory store.

## Message Creation

Sending a message is a normal JSON HTTP request. The extension includes the current agent ID, target agent ID, and content.

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

The route parses the request, writes the message to the store, then publishes a live event:

```ts
const input = await parseCreateMessageInput(request);
const message = store.createMessage(input);
publishMessageCreated(message);
```

The publish step is deliberately outside the store. The store only owns data. The event hub owns live delivery.

## Store Validation

The store verifies that both sender and target exist before creating the message:

```ts
this.assertAgentExists(input.fromAgentId, "Sender agent does not exist.");
this.assertAgentExists(input.toAgentId, "Target agent does not exist.");
```

Messages are held in memory and start as `pending`:

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

There is no persistence yet. Restarting the server clears agents and messages.
