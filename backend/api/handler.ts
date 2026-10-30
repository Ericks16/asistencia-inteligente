import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createApplication } from '../src/app-factory';

type VercelHandler = (req: VercelRequest, res: VercelResponse) => void;
let handler: VercelHandler | undefined;

function normalizeApiPath(req: VercelRequest) {
  const rawUrl = req.url ?? '/';
  const queryIndex = rawUrl.indexOf('?');
  const pathname = queryIndex >= 0 ? rawUrl.slice(0, queryIndex) : rawUrl;
  const query = queryIndex >= 0 ? rawUrl.slice(queryIndex) : '';

  if (pathname === '/api/v1' || pathname.startsWith('/api/v1/')) return;
  if (pathname === '/v1' || pathname.startsWith('/v1/')) {
    req.url = `/api${pathname}${query}`;
    return;
  }
  req.url = `/api/v1${pathname === '/' ? '' : pathname}${query}`;
}

export async function handleVercelRequest(req: VercelRequest, res: VercelResponse) {
  normalizeApiPath(req);
  if (!handler) {
    const app = await createApplication();
    await app.init();
    handler = app.getHttpAdapter().getInstance() as unknown as VercelHandler;
  }
  return handler(req, res);
}
