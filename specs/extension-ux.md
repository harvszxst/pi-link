# PI//LINK — Pi-Native Extension UX Spec
### Scope: Extension Layer Only

---

# Context

The core PI//LINK server and communication features are already implemented:

- V1: manual messaging
- V2: SSE/live communication
- V3: auto-inject inbound messages

This spec is ONLY for improving the Pi extension experience.

Do NOT rebuild the server.

Do NOT rewrite the existing message system.

Do NOT reimplement V1–V3.

Focus only on making PI//LINK feel like a normal Pi-native extension.

---

# Goal

Users should be able to open Pi normally:

```bash
pi
```

Then use PI//LINK through slash commands:

```txt
/pilink setup
/pilink connect
/pilink agents
/pilink send
```

Instead of always launching Pi with:

```bash
PI_LINK_AGENT_NAME=reviewer \
PI_LINK_AGENT_ROLE=reviewer \
PI_LINK_SERVER_URL=http://127.0.0.1:3007 \
PI_LINK_AUTO_INJECT=true \
pi -e ./extensions/pi-link.ts
```

Environment variables should still work, but they should become optional advanced overrides.

---

# Main Requirement

Implement a Pi-native command interface for the existing PI//LINK extension.

The extension should provide:

- interactive setup
- saved config
- connect/disconnect commands
- status command
- agent list command
- send message command
- inbox command
- auto-inject toggle
- local/LAN mode support

---

# Important Constraint

This spec only touches:

```txt
extensions/pi-link.ts
```

and any extension-support files needed, such as:

```txt
src/config.ts
src/extension-state.ts
src/extension-commands.ts
```

Do not change server behavior unless absolutely necessary.

---

# Default UX

## First-Time Setup

User runs:

```bash
pi -e ./extensions/pi-link.ts
```

Inside Pi:

```txt
/pilink setup
```

The extension asks for:

```txt
Agent name?
Agent role?
Server URL?
Auto inject? yes/no
Mode? local/lan
```

Then saves config.

---

## Normal Usage

User opens Pi:

```bash
pi -e ./extensions/pi-link.ts
```

Then:

```txt
/pilink connect
```

The extension loads config and connects.

---

# Future Package UX

Eventually this should support:

```bash
pi install npm:pi-link
pi
```

Then inside Pi:

```txt
/pilink setup
/pilink connect
```

But for now, keep development usage with:

```bash
pi -e ./extensions/pi-link.ts
```

---

# Config System

---

## Config Path

Store config at:

```txt
~/.pi-link/config.json
```

---

## Config Shape

```ts
export interface PiLinkConfig {
  serverUrl: string;
  agentName: string;
  agentRole?: string;
  autoInject: boolean;
  mode: "local" | "lan";
}
```

---

## Default Config

```json
{
  "serverUrl": "http://127.0.0.1:3007",
  "agentName": "agent",
  "agentRole": "assistant",
  "autoInject": false,
  "mode": "local"
}
```

---

## Environment Variable Overrides

Support these env vars as overrides:

```txt
PI_LINK_SERVER_URL
PI_LINK_AGENT_NAME
PI_LINK_AGENT_ROLE
PI_LINK_AUTO_INJECT
```

Precedence:

```txt
environment variables > saved config > defaults
```

---

# Required Slash Commands

---

# `/pilink setup`

Interactive setup wizard.

## Behavior

Ask user:

```txt
Agent name
Agent role
Server URL
Auto inject
Mode
```

Then save config to:

```txt
~/.pi-link/config.json
```

## Defaults

Use current config values as defaults if config already exists.

---

# `/pilink connect`

Connect current Pi session to PI//LINK server.

## Behavior

- Load config
- Apply env overrides
- Register current agent
- Open SSE connection if supported by existing implementation
- Start heartbeat if supported
- Enable auto-inject if config says true

## Output

Show:

```txt
Connected to PI//LINK
Agent: reviewer
Role: reviewer
Server: http://127.0.0.1:3007
Auto Inject: enabled
```

---

# `/pilink disconnect`

Disconnect current Pi session.

## Behavior

- Close SSE stream
- Stop heartbeat
- Clear active agent state
- Optionally notify server if existing endpoint supports it

## Output

```txt
Disconnected from PI//LINK
```

---

# `/pilink status`

Show current extension status.

## Output Fields

```txt
Connection: connected/disconnected
Agent ID:
Agent Name:
Agent Role:
Server URL:
Mode:
Auto Inject:
SSE:
Heartbeat:
```

---

# `/pilink agents`

List connected agents.

## Behavior

Calls existing agent list API/tool.

Should hide current agent by default.

## Output Example

```txt
Connected Agents:

1. prod
   ID: agent_xxx
   Role: gatekeeper
   Status: online

2. dev
   ID: agent_yyy
   Role: developer
   Status: online
```

---

# `/pilink send`

Interactive send flow.

## Behavior

1. Fetch connected agents.
2. Let user choose target agent.
3. Ask for message content.
4. Send message using existing send API.

## Output

```txt
Message sent to prod
Message ID: msg_xxx
```

---

# `/pilink inbox`

Check current inbox.

## Behavior

Calls existing inbox/message API.

## Output Example

```txt
Inbox:

From: prod
Message ID: msg_xxx

"Here is the redacted dataset..."
```

---

# `/pilink auto on`

Enable auto-inject.

## Behavior

- Update runtime state
- Save config autoInject = true

## Output

```txt
Auto-inject enabled
```

---

# `/pilink auto off`

Disable auto-inject.

## Behavior

- Update runtime state
- Save config autoInject = false

## Output

```txt
Auto-inject disabled
```

---

# `/pilink config`

Show current resolved config.

Must indicate where each value came from if possible:

```txt
serverUrl: http://127.0.0.1:3007 config
agentName: reviewer env
autoInject: true config
mode: local default
```

---

# `/pilink doctor`

Diagnostics command.

## Checks

- Config file exists
- Server URL is reachable
- Current agent is registered
- SSE is connected
- Auto-inject state
- Required environment values
- Extension state initialized

## Output Example

```txt
PI//LINK Doctor

Config: OK
Server: OK
Agent: connected
SSE: connected
Auto Inject: enabled
```

---

# Local/LAN UX

---

# Local Mode

Default mode.

```txt
serverUrl = http://127.0.0.1:3007
mode = local
```

No warning needed.

---

# LAN Mode

Used when connecting to another machine on same Wi-Fi/LAN.

Example:

```txt
serverUrl = http://192.168.1.25:3007
mode = lan
```

When user selects LAN mode, show warning:

```txt
LAN mode is intended only for trusted local networks.
Do not expose PI//LINK to the public internet.
```

---

# Runtime State

Create a small runtime state object for the extension.

```ts
export interface PiLinkRuntimeState {
  agentId?: string;
  agentName?: string;
  agentRole?: string;
  serverUrl?: string;
  connected: boolean;
  autoInject: boolean;
  sseConnected: boolean;
  heartbeatRunning: boolean;
}
```

---

# Clean Code Requirements

- Keep command handlers small.
- Separate config loading/saving from command handling.
- Separate runtime state from config.
- Do not duplicate API request logic.
- Reuse existing PI//LINK client functions if they exist.
- Avoid `any`.
- Use TypeScript strict mode.
- Add helpful errors.
- Do not hide failures silently.

---

# Suggested Files

If useful, split extension logic:

```txt
extensions/pi-link.ts
src/extension/config.ts
src/extension/state.ts
src/extension/commands.ts
src/extension/client.ts
```

But avoid overengineering.

If current codebase is small, keeping most logic in `extensions/pi-link.ts` is acceptable.

---

# Acceptance Criteria

This is complete when:

- `/pilink setup` saves config
- `/pilink connect` connects using saved config
- env vars still override saved config
- `/pilink status` displays correct state
- `/pilink agents` lists peers
- `/pilink send` sends a message
- `/pilink inbox` shows messages
- `/pilink auto on/off` updates config and runtime state
- `/pilink doctor` gives useful diagnostics
- default mode is local
- LAN mode shows a safety warning
- existing V1–V3 functionality still works

---

# Do Not Implement

Do not add:

- public deployment
- auth tokens
- database persistence
- new server architecture
- UI widgets
- cloud sync
- Tailscale automation
- verifier agents
- replay system
- orchestration chains

This task is only about Pi-native extension UX.
