# PI//LINK

Local and LAN messaging for Pi agents.

PI//LINK gives separate Pi agent sessions a small communication network. Agents can discover peers, send messages, receive live inbound messages, and coordinate work without merging their chat contexts.

> PI//LINK is a Pi extension. You need the Pi agent installed before using it.

## Demo

<p align="center">
  <a href="./assets/demo.mp4">
    <img src="./assets/demo.gif" alt="PI//LINK Demo" width="820">
  </a>
</p>

<p align="center">
  Two Pi agents communicating through PI//LINK.
</p>

GitHub READMEs do not reliably inline MP4 playback across every context, so PI//LINK uses a lightweight GIF preview that links to the full MP4 demo.

Later, the full MP4 can be hosted through GitHub Releases or a CDN so the README stays lightweight while still linking to high-quality video.

## Why PI//LINK Exists

Pi agents are useful as isolated work sessions, but isolation makes peer coordination awkward. PI//LINK adds a lightweight message layer so one agent can hand off context, request review, send implementation notes, or coordinate with another agent while each agent keeps its own session.

When Agent A sends a message, Agent B receives it inside Agent B's own active Pi session. PI//LINK injects the inbound message into that session as visible context, so each agent can keep working in its own workspace while still receiving peer communication.

Inbound injection is context delivery, not autonomous execution. The receiving agent does not automatically start a turn unless the user chooses to continue from that message.

## How It Works

```txt
Pi Agent A <-> PI//LINK Server <-> Pi Agent B
```

> Architecture image placeholder: local/LAN Pi agents connected through the PI//LINK HTTP/SSE server.

Agents register with a PI//LINK server, discover peers in the same network, and send messages over HTTP. Live delivery uses Server-Sent Events, so receiving agents can see inbound messages as they arrive.

The server keeps state in memory for now. Networks are runtime sessions, not permanent rooms.

## Supported Modes

| Mode | Status | Behavior |
| --- | --- | --- |
| `local` | Working now | Uses `http://127.0.0.1:3007`. Setup can start the managed local server automatically. |
| `lan` | Working now | Connects to a server URL on a trusted local network. PI//LINK never auto-starts a server in LAN mode. |
| `remote` | Future update | Planned for hosted or Tailscale-backed workflows. Not implemented yet. |

## Quick Start

### Prerequisite

Install and verify the Pi agent first. PI//LINK runs inside Pi; it is not a standalone chat client.

### Option 1: Clone This Repo Today

Clone the repository and install dependencies:

```bash
git clone git@github.com:harvszxst/pi-link.git
cd pi-link
bun install
bun run check
```

Start Pi with the extension from this checkout:

```bash
pi -e ./extensions/pi-link.ts
```

Inside Pi, run:

```txt
/pilink setup
/pilink agents
/pilink send
```

> Terminal screenshot placeholder: `/pilink setup`, `/pilink agents`, and `/pilink send` flow.

For the first agent, choose `local` mode and `create network`. For the second agent, choose `local` mode and `join network` with the same network name.

In local mode, setup can start the managed PI//LINK server automatically. In LAN mode, provide the server URL for an already-running PI//LINK server on your trusted local network.

### Option 2: Installed Pi Extension Coming Later

PI//LINK is intended to become a normal installable Pi extension in a future release. After packaging and extension integration are complete, the intended flow is:

```bash
pi
```

Then inside Pi:

```txt
/pilink setup
```

No install command is documented for this path yet because packaged Pi extension distribution is still future work.

## Core Commands

```txt
/pilink setup
/pilink agents
/pilink send
/pilink inbox
/pilink status
/pilink server start
/pilink server stop
/pilink doctor
```

## Runtime Model

PI//LINK currently uses one-time runtime networks.

- `/pilink setup` creates or joins the current network.
- The host is the agent that chooses `create network`.
- Members are agents that choose `join network`.
- If the host quits Pi, that network is no longer available.
- Members receive a warning and sending is blocked until they start or join a new network.
- Runtime state such as agent IDs, session IDs, SSE status, and connection status is not persisted.

Saved config stores preferences only.

## Use Cases

- A reviewer agent sends feedback to an implementation agent.
- A gatekeeper agent receives summaries from development agents.
- Multiple local agents coordinate without a full orchestration system.
- LAN-connected machines test agent collaboration on a trusted network.

## Current Limitations

- Requires the Pi agent.
- Local and LAN modes are available now; remote mode is not implemented yet.
- Server state is in memory only.
- No authentication or encryption yet.
- No persisted network/session restore yet.
- Not intended as a production orchestration platform yet.
- Packaged Pi extension installation is future work.

## Deeper Docs

- [Core Functionality](docs/core-functionality.md)
- [Runtime UX Spec](specs/runtime-ux.md)
