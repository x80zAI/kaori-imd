import { PublicError } from './ethereum.mjs';

export function parseRequestUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2_048 || !rawUrl.startsWith('/') || rawUrl.startsWith('//') || rawUrl.includes('#')) {
    throw new PublicError('This request URL is invalid.', 400, 'invalid');
  }
  let decodedPath;
  let url;
  try {
    decodedPath = decodeURIComponent(rawUrl.split(/[?#]/, 1)[0]);
    decodeURIComponent(rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : '');
    url = new URL(rawUrl, 'http://localhost');
  } catch { throw new PublicError('This request URL is invalid.', 400, 'invalid'); }
  if (/[\x00-\x1f\x7f\\:]/.test(decodedPath) || decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new PublicError('This request path is invalid.', 400, 'invalid');
  }
  return { url, pathname: decodedPath };
}

export function sendJson(response, status, body, extraHeaders = {}) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [name, value] of Object.entries(extraHeaders)) response.setHeader(name, value);
  response.end(JSON.stringify(body));
}

export function createApiHandler(kind, service) {
  if (!['receipt', 'recent', 'allowance'].includes(kind)) throw new Error('Invalid API route');
  return async function handler(request, response) {
    try {
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'Use GET to read Ethereum data.', code: 'invalid' }, { Allow: 'GET' });
        return;
      }
      const { url, pathname } = parseRequestUrl(request.url);
      if (pathname !== `/api/${kind}`) throw new PublicError('This data endpoint does not exist.', 404, 'not_found');
      const keys = [...url.searchParams.keys()];
      let result;
      if (kind === 'recent') {
        if (keys.length) throw new PublicError('This endpoint does not accept query parameters.', 400, 'invalid');
        result = await service.getRecent();
      } else if (kind === 'allowance') {
        if (keys.length !== 2 || keys.filter((key) => key === 'owner').length !== 1 || keys.filter((key) => key === 'spender').length !== 1) {
          throw new PublicError('Provide one wallet address using owner and one application address using spender.', 400, 'invalid');
        }
        result = await service.getAllowance(url.searchParams.get('owner'), url.searchParams.get('spender'));
      } else {
        if (keys.length !== 1 || keys[0] !== 'hash') throw new PublicError('Provide one transaction hash using the hash parameter.', 400, 'invalid');
        result = await service.getReceipt(url.searchParams.get('hash'));
      }
      sendJson(response, 200, result);
    } catch (error) {
      const known = error instanceof PublicError;
      sendJson(response, known ? error.status : 503, { error: known ? error.message : 'Ethereum data is unavailable right now. Please try again shortly.', code: known ? error.code : 'unavailable' });
    }
  };
}
