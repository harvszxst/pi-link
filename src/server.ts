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
