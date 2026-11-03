import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleVercelRequest } from './handler';

export default async function loginCedula(req: VercelRequest, res: VercelResponse) {
  const queryIndex = (req.url ?? '').indexOf('?');
  const query = queryIndex >= 0 ? (req.url ?? '').slice(queryIndex) : '';
  req.url = `/api/v1/auth/login-cedula${query}`;
  return handleVercelRequest(req, res);
}
