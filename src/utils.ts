import type { ErrorCode, JsonError } from "./types";

/**
 * Returns the current timestamp in the wire format used by PI//LINK.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Creates a short readable ID with a stable domain prefix.
 */
export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/**
 * Returns a JSON response using the platform serializer.
 */
export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

/**
 * Formats a stable PI//LINK JSON error response.
 */
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

/**
 * Narrows unknown JSON into a plain object record.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a required non-empty string field from a parsed JSON object.
 */
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

/**
 * Reads an optional non-empty string field from a parsed JSON object.
 */
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
