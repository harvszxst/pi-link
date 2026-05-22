/**
 * PI//LINK — Bun HTTP/SSE server entrypoint
 *
 * Starts the development Bun server around the shared route handler. This server
 * keeps all agent, message, and network state in memory, listens on the configured
 * local host/port, and exposes the same JSON/SSE API mirrored by the packaged
 * Node `pi-link-server` binary.
 */
import {
  DEFAULT_HOSTNAME,
  DEFAULT_PORT,
  SERVICE_NAME,
  VERSION,
} from "./constants";
import { handleRequest } from "./routes";

const port = Number(process.env.PI_LINK_PORT ?? DEFAULT_PORT);
const hostname = process.env.PI_LINK_HOST ?? DEFAULT_HOSTNAME;

Bun.serve({
  hostname,
  port,
  fetch: handleRequest,
});

console.log(`${SERVICE_NAME} ${VERSION} listening on http://${hostname}:${port}`);
