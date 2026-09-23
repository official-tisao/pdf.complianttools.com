import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 8787);
const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, mode: 'self-hosted-relay' }));
    return;
  }
  response.writeHead(501, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      error: 'not-implemented',
      message:
        'Webpage capture is intentionally opt-in and will be added behind the Relay contract.',
    }),
  );
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Relay listening on http://127.0.0.1:${port}`);
});
