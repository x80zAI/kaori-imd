import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { PublicError } from './ethereum.mjs';
import { parseRequestUrl, sendJson } from './http.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4',
};

export function isWithinDirectory(directory, candidate) {
  const difference = relative(directory, candidate);
  return difference === '' || (!isAbsolute(difference) && difference !== '..' && !difference.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

export async function resolveStaticFile(distDirectory, rawUrl, accept = '') {
  const { pathname } = parseRequestUrl(rawUrl);
  if (pathname.split('/').some((part) => part.startsWith('.'))) throw new PublicError('This file is unavailable.', 404, 'not_found');
  const dist = await realpath(distDirectory);
  const requested = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!isWithinDirectory(dist, requested)) throw new PublicError('This request path is invalid.', 400, 'invalid');
  let candidate = requested;
  try {
    if (!(await stat(candidate)).isFile()) throw new Error('Not a file');
  } catch (error) {
    if (error?.code && !['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    if (extname(pathname) || !/(?:text\/html|\*\/\*)/.test(accept)) throw new PublicError('This file is unavailable.', 404, 'not_found');
    candidate = resolve(dist, 'index.html');
  }
  const actual = await realpath(candidate);
  if (!isWithinDirectory(dist, actual)) throw new PublicError('This file is unavailable.', 404, 'not_found');
  const file = await stat(actual);
  if (!file.isFile()) throw new PublicError('This file is unavailable.', 404, 'not_found');
  return { path: actual, size: file.size, type: TYPES[extname(actual).toLowerCase()] ?? 'application/octet-stream' };
}

export function createStaticHandler(distDirectory) {
  return async function staticHandler(request, response) {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        sendJson(response, 405, { error: 'Use GET or HEAD to open this page.' }, { Allow: 'GET, HEAD' });
        return;
      }
      const file = await resolveStaticFile(distDirectory, request.url, request.headers.accept ?? '');
      response.statusCode = 200;
      response.setHeader('Content-Type', file.type);
      response.setHeader('Content-Length', file.size);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cache-Control', file.type.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600');
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(file.path);
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      sendJson(response, error instanceof PublicError ? error.status : 404, {
        error: error instanceof PublicError ? error.message : 'The built website is unavailable. Run npm run build first.',
      });
    }
  };
}
