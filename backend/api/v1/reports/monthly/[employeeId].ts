import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleVercelRequest } from '../../../handler';

export default async function monthly(req: VercelRequest, res: VercelResponse) {
  return handleVercelRequest(req, res);
}
