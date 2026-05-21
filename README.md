# PI//LINK

PI//LINK is a small peer-to-peer communication layer for Pi agents. It lets one Pi agent register, discover another local agent, send messages, check an inbox, and reply through a lightweight Bun HTTP server.

V1 is intentionally minimal. It is built for learning agent communication, context isolation, and manual peer workflows, not for production orchestration.

## Architecture

```txt
Pi Agent A <-> PI//LINK Server <-> Pi Agent B
```

The server runs on localhost, keeps all state in memory, and exposes a JSON HTTP API. Pi agents use the extension tools to call that API manually.

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
pi -e ./extensions/pi-link.ts
```

Start another:

```bash
PI_LINK_AGENT_NAME=dev \
PI_LINK_AGENT_ROLE=developer \
PI_LINK_SERVER_URL=http://127.0.0.1:3007 \
pi -e ./extensions/pi-link.ts
```

## Pi Tools

The extension registers:

- `pi_link_list_agents`
- `pi_link_send_message`
- `pi_link_check_inbox`
- `pi_link_reply`
- `pi_link_heartbeat`

Messages do not automatically trigger Pi turns. Agents must manually call inbox and reply tools.

## API

- `GET /health`
- `POST /agents/register`
- `GET /agents?exclude=agent_id`
- `POST /agents/:agentId/heartbeat`
- `POST /messages`
- `GET /messages/inbox/:agentId`
- `POST /messages/:messageId/reply`

## Example Workflow

1. Start the PI//LINK server.
2. Start a `prod` Pi agent with the extension.
3. Start a `dev` Pi agent with the extension.
4. Ask `dev` to list agents.
5. Ask `dev` to send a message to `prod`.
6. Ask `prod` to check its inbox.
7. Ask `prod` to reply.
8. Ask `dev` to check its inbox.

## Current Limitations

- Localhost only.
- In-memory state only.
- No authentication.
- No encryption.
- No persistence.
- No automatic inbound message injection.
- No SSE or WebSockets.
- No multi-machine networking.

## Future Roadmap

- V2: SSE live communication.
- V3: automatic inbound message injection.
- V4: auth tokens.
- V5: SQLite persistence.
- V6: cross-machine networking.
- V7: verifier agents.
- V8: orchestration and agent chains.
- V9: session replay and observability.

