import { fileURLToPath } from 'node:url';
import { createRelayServer, parseAllowedOrigins } from './server.js';

const port = Number(process.env.PORT ?? 8787);
const allowPrivate = process.env.RELAY_ALLOW_PRIVATE_NETWORK === '1';

// Only bind when executed directly. Importing this module must not open a
// listening socket, or any test that touches it would hang the runner.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const allowedOrigins = parseAllowedOrigins(process.env.RELAY_ALLOWED_ORIGINS);
  createRelayServer({ allowPrivate, allowedOrigins }).listen(port, '127.0.0.1', () =>
    console.log(
      `Relay listening on http://127.0.0.1:${port} (CORS origins: ${allowedOrigins.join(', ')})`,
    ),
  );
}
