import { app } from "../src/app.js";
export default async function handler(req, res) {
    // Convert Vercel's IncomingMessage to a standard Request
    const proto = req.headers["x-forwarded-proto"] ?? "https";
    const host = req.headers["host"] ?? "localhost";
    const url = `${proto}://${host}${req.url}`;
    const body = req.method !== "GET" && req.method !== "HEAD"
        ? await new Promise((resolve) => {
            const chunks = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", () => resolve(Buffer.concat(chunks)));
        })
        : undefined;
    const webReq = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: body?.length ? body : undefined,
    });
    const webRes = await app.fetch(webReq);
    res.status(webRes.status);
    webRes.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await webRes.arrayBuffer()));
}
//# sourceMappingURL=index.js.map