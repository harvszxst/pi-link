# PI//LINK — One-Time Network Runtime UX

## Goal

PI//LINK networks are temporary runtime sessions for now. Saved config stores setup preferences only; it does not reopen or restore a previous network after Pi restarts.

## Important Rule

Persist preferences only.

Do NOT persist runtime state:

```txt
agentId
sessionId
connected
sseConnected
heartbeatRunning
```

## Startup Behavior

### No Config

Show:

```txt
PI//LINK not configured.
Run /pilink setup.
```

### Config Exists

Show:

```txt
PI//LINK config detected.
Run /pilink setup to start or join a network.
```

Do not auto-register or prompt for reconnect on startup.

## Network Lifecycle

### Host Starts Network

Running `/pilink setup` with `create network` registers the current Pi process as the network host.

### Host Quits Pi

The host's SSE connection closes, the server marks that host offline, and joined members receive:

```txt
PI//LINK network host is offline.
This network is no longer available.
Run /pilink setup to start or join a new PI//LINK network.
```

### Member Sends After Host Quits

Sending is blocked:

```txt
Cannot send message.
Network host is offline.
This network is no longer available.
```

## Out Of Scope For Now

- reconnecting old host sessions
- saved network profile lists
- reopening previous networks
- automatic startup reconnect
- disabled previous-network UI

## Acceptance Criteria

- No startup reconnect prompt.
- No automatic startup registration.
- `/pilink setup` starts or joins the current runtime network.
- Host disconnect notifies members.
- Members cannot send after the host goes offline.
- Runtime connection state is never persisted.
