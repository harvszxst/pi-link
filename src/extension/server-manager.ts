/**
 * PI//LINK — managed local server lifecycle
 *
 * Starts, stops, and reports status for the package-managed `pi-link-server`
 * process used in local mode. LAN mode remains explicit and never spawns a local
 * server; remote mode is reserved for a future hosted/Tailscale-backed flow.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PiLinkClient } from "./client";
import { runtimeState } from "./state";
import type { PiLinkConfig } from "./types";

export interface ServerStatus {
  reachable: boolean;
  managed: boolean;
  running: boolean;
  startedByExtension: boolean;
  port: number | undefined;
}

const START_TIMEOUT_MS = 5_000;
const START_POLL_MS = 150;

/**
 * Starts the package-managed PI//LINK server when local mode needs one.
 */
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

/**
 * Starts a local managed server process for the configured URL.
 */
export async function startManagedServer(serverUrl: string): Promise<ServerStatus> {
  const client = new PiLinkClient(serverUrl);
  const endpoint = parseServerEndpoint(serverUrl);

  if (await isServerReachable(client)) {
    runtimeState.managedServerPort = endpoint.port;
    runtimeState.managedServerStartedByExtension = false;
    return statusFromReachability(true);
  }

  const current = runtimeState.managedServerProcess;
  if (current !== undefined && current.exitCode === null) {
    return statusFromReachability(false);
  }

  const scriptPath = resolveServerBinPath();
  const child = spawn(process.execPath, [scriptPath], {
    env: {
      ...process.env,
      PI_LINK_HOST: endpoint.hostname,
      PI_LINK_PORT: String(endpoint.port),
    },
    stdio: "ignore",
  });

  child.unref();
  runtimeState.managedServerProcess = child;
  runtimeState.managedServerPort = endpoint.port;
  runtimeState.managedServerStartedByExtension = true;

  child.once("exit", () => {
    if (runtimeState.managedServerProcess === child) {
      runtimeState.managedServerProcess = undefined;
      runtimeState.managedServerStartedByExtension = false;
    }
  });

  await waitForServer(client);
  return statusFromReachability(true);
}

/**
 * Stops the server process only when this extension started it.
 */
export function stopManagedServer(): boolean {
  const child = runtimeState.managedServerProcess;
  if (child === undefined || child.exitCode !== null) {
    runtimeState.managedServerProcess = undefined;
    runtimeState.managedServerStartedByExtension = false;
    return false;
  }

  child.kill();
  runtimeState.managedServerProcess = undefined;
  runtimeState.managedServerStartedByExtension = false;
  return true;
}

/**
 * Reports the local process state and whether the configured server responds.
 */
export async function getServerStatus(serverUrl: string): Promise<ServerStatus> {
  const reachable = await isServerReachable(new PiLinkClient(serverUrl));
  const endpoint = parseServerEndpoint(serverUrl);
  runtimeState.managedServerPort = runtimeState.managedServerPort ?? endpoint.port;
  return statusFromReachability(reachable);
}

export async function isServerReachable(client: PiLinkClient): Promise<boolean> {
  try {
    await client.health();
    return true;
  } catch {
    return false;
  }
}

function statusFromReachability(reachable: boolean): ServerStatus {
  const child = runtimeState.managedServerProcess;
  const running = child !== undefined && child.exitCode === null;
  return {
    reachable,
    managed: running && runtimeState.managedServerStartedByExtension,
    running,
    startedByExtension: runtimeState.managedServerStartedByExtension,
    port: runtimeState.managedServerPort,
  };
}

async function waitForServer(client: PiLinkClient): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    if (await isServerReachable(client)) {
      return;
    }
    await sleep(START_POLL_MS);
  }

  throw new Error("Timed out waiting for managed PI//LINK server to start.");
}

function parseServerEndpoint(serverUrl: string): { hostname: string; port: number } {
  const url = new URL(serverUrl);
  if (url.protocol !== "http:") {
    throw new Error("Managed local server requires an http:// server URL.");
  }

  return {
    hostname: url.hostname,
    port: url.port.length > 0 ? Number(url.port) : 80,
  };
}

function resolveServerBinPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../bin/pi-link-server.mjs"),
    resolve(here, "../bin/pi-link-server.mjs"),
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error("Could not find pi-link-server package bin.");
  }

  return found;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
