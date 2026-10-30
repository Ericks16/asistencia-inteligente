import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createApplication } from '../src/app-factory';

type VercelHandler = (req: VercelRequest, res: VercelResponse) => void;
let handler: VercelHandler | undefined;

export default async function vercelHandler(req: VercelRequest, res: VercelResponse) {
  if (!handler) {
    const app = await createApplication();
    await app.init();
    handler = app.getHttpAdapter().getInstance() as unknown as VercelHandler;
  }
  return handler!(req, res);
}
