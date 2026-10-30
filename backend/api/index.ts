import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createApplication } from '../src/app-factory';

let handler: ((req: VercelRequest, res: VercelResponse) => void) | undefined;

export default async function vercelHandler(req: VercelRequest, res: VercelResponse) {
  if (!handler) {
    const app = await createApplication();
    await app.init();
    handler = app.getHttpAdapter().getInstance();
  }
  return handler(req, res);
}
