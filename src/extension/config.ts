import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type {
  ConfigSource,
  PiLinkConfig,
  PiLinkConfigSources,
  PiLinkMode,
  ResolvedPiLinkConfig,
} from "./types";

export const CONFIG_PATH = join(homedir(), ".pi-link", "config.json");

export const DEFAULT_CONFIG: PiLinkConfig = {
  serverUrl: "http://127.0.0.1:3007",
  agentName: "agent",
  agentRole: "assistant",
  autoInject: true,
  mode: "local",
};

type PartialConfig = Partial<PiLinkConfig>;

/**
 * Resolves config using env overrides, saved config, then defaults.
 */
export async function resolveConfig(): Promise<ResolvedPiLinkConfig> {
  const saved = await loadConfig();
  const env = readEnvOverrides();
  const sources = createDefaultSources();
  const values: PiLinkConfig = { ...DEFAULT_CONFIG };

  applyConfig(values, sources, saved.config, "config");
  applyConfig(values, sources, env, "env");

  return {
    values,
    sources,
    configExists: saved.exists,
  };
}

/**
 * Loads saved PI//LINK config from the user home directory.
 */
export async function loadConfig(): Promise<{
  config: PartialConfig;
  exists: boolean;
}> {
  try {
    const text = await readFile(CONFIG_PATH, "utf8");
    return {
      config: parseConfig(JSON.parse(text) as unknown),
      exists: true,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return { config: {}, exists: false };
    }

    throw error;
  }
}

/**
 * Saves PI//LINK config to ~/.pi-link/config.json.
 */
export async function saveConfig(config: PiLinkConfig): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  const tempPath = `${CONFIG_PATH}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`);
  await rename(tempPath, CONFIG_PATH);
}

/**
 * Merges a partial config with the resolved active config and persists it.
 */
export async function updateSavedConfig(
  patch: PartialConfig,
): Promise<PiLinkConfig> {
  const current = await resolveConfig();
  const next: PiLinkConfig = {
    ...current.values,
    ...patch,
  };
  await saveConfig(next);
  return next;
}

function parseConfig(value: unknown): PartialConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const config: PartialConfig = {};

  if (typeof record.serverUrl === "string" && record.serverUrl.trim()) {
    config.serverUrl = record.serverUrl.trim();
  }

  if (typeof record.agentName === "string" && record.agentName.trim()) {
    config.agentName = record.agentName.trim();
  }

  if (typeof record.agentRole === "string" && record.agentRole.trim()) {
    config.agentRole = record.agentRole.trim();
  }

  if (typeof record.autoInject === "boolean") {
    config.autoInject = record.autoInject;
  }

  if (record.mode === "local" || record.mode === "lan") {
    config.mode = record.mode;
  }

  return config;
}

function readEnvOverrides(): PartialConfig {
  const config: PartialConfig = {};
  const serverUrl = readStringEnv("PI_LINK_SERVER_URL");
  const agentName = readStringEnv("PI_LINK_AGENT_NAME");
  const agentRole = readStringEnv("PI_LINK_AGENT_ROLE");
  const autoInject = readBooleanEnv("PI_LINK_AUTO_INJECT");

  if (serverUrl !== undefined) {
    config.serverUrl = serverUrl;
  }

  if (agentName !== undefined) {
    config.agentName = agentName;
  }

  if (agentRole !== undefined) {
    config.agentRole = agentRole;
  }

  if (autoInject !== undefined) {
    config.autoInject = autoInject;
  }

  return config;
}

function applyConfig(
  values: PiLinkConfig,
  sources: PiLinkConfigSources,
  config: PartialConfig,
  source: ConfigSource,
): void {
  for (const key of Object.keys(config) as Array<keyof PiLinkConfig>) {
    const value = config[key];
    if (value === undefined) {
      continue;
    }

    values[key] = value as never;
    sources[key] = source;
  }
}

function createDefaultSources(): PiLinkConfigSources {
  return {
    serverUrl: "default",
    agentName: "default",
    agentRole: "default",
    autoInject: "default",
    mode: "default",
  };
}

function readStringEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function readBooleanEnv(name: string): boolean | undefined {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  return !["0", "false", "no", "off"].includes(value);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
