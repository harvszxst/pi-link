export const SERVICE_NAME = "pi-link";
export const VERSION = "0.2.0";
export const DEFAULT_HOSTNAME = "127.0.0.1";
export const DEFAULT_PORT = 3007;

export const ERROR_CODES = {
  invalidRequest: "INVALID_REQUEST",
  agentNotFound: "AGENT_NOT_FOUND",
  messageNotFound: "MESSAGE_NOT_FOUND",
  serverError: "SERVER_ERROR",
} as const;
