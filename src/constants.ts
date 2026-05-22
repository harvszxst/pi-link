/**
 * PI//LINK — server constants and domain error codes
 *
 * Centralizes public service identity, default bind settings, and stable error
 * code strings shared by the Bun server, Node package server, routes, and store.
 * Keep these codes stable because extension clients use them to surface clear
 * user-facing failures such as host-offline and network-mismatch states.
 */
export const SERVICE_NAME = "pi-link";
export const VERSION = "0.3.0";
export const DEFAULT_HOSTNAME = "127.0.0.1";
export const DEFAULT_PORT = 3007;

export const ERROR_CODES = {
  invalidRequest: "INVALID_REQUEST",
  agentNotFound: "AGENT_NOT_FOUND",
  hostOffline: "HOST_OFFLINE",
  messageNotFound: "MESSAGE_NOT_FOUND",
  networkMismatch: "NETWORK_MISMATCH",
  serverError: "SERVER_ERROR",
} as const;
