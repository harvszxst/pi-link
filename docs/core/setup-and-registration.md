# Setup and Registration

This page explains what happens when Pi loads PI//LINK and when the user runs `/pilink setup`.

## Config Resolution

The extension resolves config from environment variables, `~/.pi-link/config.json`, and defaults. Saved config is the normal path; environment variables are still advanced overrides.

```ts
const config = await resolveConfig();
```

The defaults keep first-run local development simple:

```ts
export const DEFAULT_CONFIG: PiLinkConfig = {
  serverUrl: "http://127.0.0.1:3007",
  agentName: "agent",
  agentRole: "assistant",
  autoInject: true,
  mode: "local",
  networkAction: "create",
  networkName: "default",
};
```

## Setup Flow

`/pilink setup` is the primary onboarding command. It asks for the mode first:

- `local`: uses `http://127.0.0.1:3007` automatically.
- `lan`: asks for the server URL and never starts a local server.
- `remote`: shows a friendly future Tailscale integration note and stops without saving or connecting.

After mode selection, setup asks whether to create or join a network and stores the network name locally. This is a label for now; it does not change server routing or isolate agents.

```ts
const config: PiLinkConfig = {
  serverUrl,
  agentName,
  autoInject: autoInjectChoice === "yes",
  mode,
  networkAction,
  networkName,
};
```

After saving config, setup immediately connects the agent:

```ts
await saveConfig(config);
applyRuntimeConfig(config);
const result = await connectPiLink(pi, ctx);
```

## Agent Registration

Registration sends the current Pi session identity to the server:

```ts
const agent = await client.registerAgent({
  name: config.values.agentName,
  role: config.values.agentRole,
  sessionId: runtimeState.sessionId,
});
```

The server store uses `sessionId` as the stable identity for a running Pi process. Re-registering the same session refreshes the existing agent instead of creating a duplicate.

```ts
const existingId = this.agentsBySessionId.get(input.sessionId);
```

After registration succeeds, the extension stores the returned agent and active config in runtime state.

```ts
runtimeState.agentId = agent.id;
runtimeState.agentName = agent.name;
runtimeState.serverUrl = config.serverUrl;
runtimeState.mode = config.mode;
runtimeState.networkName = config.networkName;
runtimeState.connected = true;
```

That gives a simple local lifecycle: restart the extension process and it gets a new session ID; re-register within the same process and it refreshes the existing agent.
