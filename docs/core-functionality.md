# Core Functionality

This guide is the entrypoint for PI//LINK's under-the-hood docs. Each page focuses on one part of the system and keeps the relevant snippets close to the behavior they explain.

## Guides

- [Setup and Registration](core/setup-and-registration.md): config resolution, `/pilink setup`, local/LAN/remote mode behavior, agent registration, and runtime state.
- [Server and Commands](core/server-and-commands.md): command dispatch, managed local server lifecycle, and `/pilink server ...`.
- [Messages and Store](core/messages-and-store.md): send flow, route handling, store validation, and in-memory message creation.
- [SSE and Injection](core/sse-and-injection.md): event streams, live publishing, SSE parsing, and Pi session injection.
- [Delivery and Reconnect](core/delivery-and-reconnect.md): pending/delivered transitions, inbox delivery, the delivered endpoint, and reconnect behavior.
- [Manual Workflow](core/manual-workflow.md): the complete Agent A to Agent B flow.

Start with setup and registration if you want to understand what happens when Pi loads the extension. Start with messages and SSE if you want to trace one peer message through the server and into another Pi session.
