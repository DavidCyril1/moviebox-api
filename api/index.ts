/**
 * Vercel serverless entry point.
 * Exports the Hono app's fetch handler as the default export.
 * Vercel routes all requests here via vercel.json.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { app } from "../src/app.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Convert Vercel's IncomingMessage to a standard Request
  const proto = (req.headers["x-forwarded-proto"] as string) ?? "https";
  const host  = req.headers["host"] ?? "localhost";
  const url   = `${proto}://${host}${req.url}`;

  const body =
    req.method !== "GET" && req.method !== "HEAD"
      ? await new Promise<Buffer>((resolve) => {
          const chunks: Buffer[] = [];
          req.on("data", (c: Buffer) => chunks.push(c));
          req.on("end", () => resolve(Buffer.concat(chunks)));
        })
      : undefined;

  const webReq = new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: body?.length ? body : undefined,
  });

  const webRes = await app.fetch(webReq);

  res.status(webRes.status);
  webRes.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await webRes.arrayBuffer()));
}
