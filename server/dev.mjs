import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import receiptHandler from '../api/receipt.js';
import recentHandler from '../api/recent.js';
import allowanceHandler from '../api/allowance.js';
import { parseRequestUrl, sendJson } from './http.mjs';
import { createStaticHandler } from './static.mjs';
import { PublicError } from './ethereum.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const production = process.argv.includes('--production');
const port = 5203;
let vite;
const staticHandler = createStaticHandler(resolve(root, 'dist'));
const server = createServer(async (request, response) => {
  try {
    const { pathname } = parseRequestUrl(request.url);
    if (pathname === '/api/receipt') return await receiptHandler(request, response);
    if (pathname === '/api/recent') return await recentHandler(request, response);
    if (pathname === '/api/allowance') return await allowanceHandler(request, response);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'This data endpoint does not exist.', code: 'not_found' });
      return;
    }
    if (production) return await staticHandler(request, response);
    if (!['GET', 'HEAD'].includes(request.method)) {
      sendJson(response, 405, { error: 'Use GET or HEAD to open this page.' }, { Allow: 'GET, HEAD' });
      return;
    }
    vite.middlewares(request, response, () => sendJson(response, 404, { error: 'This page is unavailable.' }));
  } catch (error) {
    sendJson(response, error instanceof PublicError ? error.status : 500, {
      error: error instanceof PublicError ? error.message : 'The website could not handle this request. Please try again.',
    });
  }
});
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
if (!production) {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({ root, appType: 'spa', server: { middlewareMode: { server }, host: '127.0.0.1', port, hmr: { server } } });
}
server.on('error', async (error) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : 'The local server could not start.');
  await vite?.close();
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`Kaori IMD ${production ? 'preview' : 'development'}: http://127.0.0.1:${port}`));
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close();
  server.closeAllConnections();
  await vite?.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
