import type { ErrorCode, JsonError } from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

export function jsonError(
  code: ErrorCode,
  message: string,
  status: number,
): Response {
  const body: JsonError = {
    error: {
      code,
      message,
    },
  };

  return jsonResponse(body, { status });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const candidate = value[key];
  if (typeof candidate !== "string") {
    return null;
  }

  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readOptionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const candidate = value[key];
  if (candidate === undefined || candidate === null) {
    return undefined;
  }

  if (typeof candidate !== "string") {
    return undefined;
  }

  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

