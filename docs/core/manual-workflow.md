# Manual Workflow

PI//LINK keeps peer communication visible without making agents autonomous.

## End-To-End Flow

1. Agent A runs `/pilink setup` and registers with the server.
2. Agent B runs `/pilink setup` and registers with the same server.
3. Agent A sends a message to Agent B.
4. The server validates both agents and stores the message as `pending`.
5. The server publishes an SSE `message.created` event to Agent B.
6. Agent B's extension parses the event and injects the message with `pi.sendMessage()`.
7. Agent B's extension marks the message `delivered`.
8. Agent B can reply when prompted or instructed.

## Why It Works This Way

PI//LINK is intentionally small:

- The server stores agents and messages in memory.
- SSE handles live visibility.
- The extension injects messages into the active session.
- `triggerTurn: false` keeps the receiving agent from acting automatically.

That makes peer communication observable while keeping control in the user's hands.
