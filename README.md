# PI//LINK

PI//LINK is a small peer-to-peer communication layer for Pi agents. It lets one Pi agent register, discover another local agent, send messages, receive live inbound session messages, check an inbox, and reply through a lightweight Bun HTTP server.

V3 adds automatic inbound message injection on top of Server-Sent Events. It is built for learning agent communication, context isolation, and peer workflows, not for production orchestration.

## Architecture

```txt
Pi Agent A <-> PI//LINK Server <-> Pi Agent B
```

The server runs on localhost, keeps all state in memory, exposes a JSON HTTP API, and provides one SSE stream per connected agent. Pi agents use extension tools for actions and receive inbound PI//LINK messages directly in the active session.

## Setup

Install dependencies:

```bash
bun install
```

Run type checks:

```bash
bun run check
```

## Running The Server

```bash
bun src/server.ts
```

By default the server listens on:

```txt
http://127.0.0.1:3007
```

Optional server environment variables:

```bash
PI_LINK_HOST=127.0.0.1
PI_LINK_PORT=3007
```

## Running Pi Agents

Start one Pi agent:

```bash
PI_LINK_AGENT_NAME=prod \
PI_LINK_AGENT_ROLE=gatekeeper \
PI_LINK_SERVER_URL=http://127.0.0.1:3007 \
PI_LINK_AUTO_INJECT=true \
pi -e ./extensions/pi-link.ts
```

Start another:

```bash
PI_LINK_AGENT_NAME=dev \
PI_LINK_AGENT_ROLE=developer \
PI_LINK_SERVER_URL=http://127.0.0.1:3007 \
PI_LINK_AUTO_INJECT=true \
pi -e ./extensions/pi-link.ts
```

`PI_LINK_AUTO_INJECT` defaults to `true`. Set it to `false` to keep V2 notification-only behavior.

## Pi Tools

The extension registers:

- `pi_link_list_agents`
- `pi_link_send_message`
- `pi_link_check_inbox`
- `pi_link_reply`
- `pi_link_heartbeat`

Inbound messages are injected into the active Pi session by default, but they do not automatically trigger Pi turns. Agents can still manually call inbox and reply tools.

## API

- `GET /health`
- `POST /agents/register`
- `GET /agents?exclude=agent_id`
- `POST /agents/:agentId/heartbeat`
- `GET /events/:agentId`
- `POST /messages`
- `GET /messages/inbox/:agentId`
- `POST /messages/:messageId/delivered`
- `POST /messages/:messageId/reply`

## Example Workflow

1. Start the PI//LINK server.
2. Start a `prod` Pi agent with the extension.
3. Start a `dev` Pi agent with the extension.
4. Ask `dev` to list agents.
5. Ask `dev` to send a message to `prod`.
6. `prod` receives an injected PI//LINK message in-session.
7. Ask `prod` to reply.
8. `dev` receives an injected PI//LINK message in-session.

## Learning Docs

Read [Core Functionality](docs/core-functionality.md) for a walkthrough of the important code paths and snippets.

## Current Limitations

- Localhost only.
- In-memory state only.
- No authentication.
- No encryption.
- No persistence.
- No automatic agent turn triggering.
- No WebSockets.
- No multi-machine networking.

## Future Roadmap

- V2: SSE live communication. Done.
- V3: automatic inbound message injection. Done.
- V4: auth tokens.
- V5: SQLite persistence.
- V6: cross-machine networking.
- V7: verifier agents.
- V8: orchestration and agent chains.
- V9: session replay and observability.
