import { createRelayServer, parseAllowedOrigins } from './server.js';

const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error('PORT must be an integer between 0 and 65535.');
}

const host = process.env.HOST ?? '127.0.0.1';
const server = createRelayServer({
  allowPrivate: process.env.RELAY_ALLOW_PRIVATE_NETWORK === '1',
  allowedOrigins: parseAllowedOrigins(process.env.RELAY_ALLOWED_ORIGINS),
});

server.listen(port, host, () => {
  const address = server.address();
  const listeningPort = typeof address === 'object' && address ? address.port : port;
  console.log(`PDF capture Relay listening at http://${host}:${listeningPort}`);
});
