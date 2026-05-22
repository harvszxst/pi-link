# Server and Commands

This page explains the command layer and the managed local server behavior.

## Pi-Native Commands

PI//LINK exposes one Pi slash command with subcommands:

```txt
/pilink setup
/pilink disconnect
/pilink status
/pilink agents
/pilink send
/pilink inbox
/pilink auto on
/pilink auto off
/pilink server start
/pilink server stop
/pilink server status
/pilink config
/pilink doctor
```

The command layer handles user interaction with `ctx.ui.input`, `ctx.ui.select`, and `ctx.ui.notify`. The client module handles HTTP calls.

```ts
pi.registerCommand("pilink", {
  description: "Manage PI//LINK setup, connection, and messaging",
  handler: async (args, ctx) => {
    await handlePiLinkCommand(pi, args, ctx);
  },
});
```

## Managed Local Server

In local mode, connection setup checks `/health`. If no server is reachable, the extension starts the package `pi-link-server` bin.

```ts
export async function ensureLocalServer(config: PiLinkConfig): Promise<void> {
  if (config.mode !== "local") {
    return;
  }

  const client = new PiLinkClient(config.serverUrl);
  if (await isServerReachable(client)) {
    return;
  }

  await startManagedServer(config.serverUrl);
}
```

Starting the managed server uses the current Node executable and passes host/port through environment variables:

```ts
const child = spawn(process.execPath, [scriptPath], {
  env: {
    ...process.env,
    PI_LINK_HOST: endpoint.hostname,
    PI_LINK_PORT: String(endpoint.port),
  },
  stdio: "ignore",
});
```

The extension tracks whether it owns that process:

```ts
runtimeState.managedServerProcess = child;
runtimeState.managedServerPort = endpoint.port;
runtimeState.managedServerStartedByExtension = true;
```

`/pilink server stop` only stops an extension-managed process. If another server is already running at the configured URL, PI//LINK treats it as unmanaged and leaves it alone.

## LAN and Remote Modes

LAN mode is explicit: setup connects to the configured URL and never spawns a local server.

Remote mode is visible but not implemented yet. Selecting it shows a future Tailscale integration note and does not save remote config or connect.
