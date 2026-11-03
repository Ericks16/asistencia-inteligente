import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleVercelRequest } from '../handler';

export default async function health(req: VercelRequest, res: VercelResponse) {
  return handleVercelRequest(req, res);
}
