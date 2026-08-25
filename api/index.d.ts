/**
 * Vercel serverless entry point.
 * Exports the Hono app's fetch handler as the default export.
 * Vercel routes all requests here via vercel.json.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
export default function handler(req: VercelRequest, res: VercelResponse): Promise<void>;
