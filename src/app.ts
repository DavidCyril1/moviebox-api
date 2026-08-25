import { Hono } from "hono";
import type { Context } from "hono";
import * as mb from "./client.js";

export const app = new Hono();

// ── Helpers ───────────────────────────────────────────────────────────────────

type Handler = (c: Context) => Promise<Response>;

function param(c: Context, name: string): string {
  const v = c.req.param(name);
  if (v === undefined) throw new Error(`Missing route param: ${name}`);
  return v;
}

function wrap(fn: (c: Context) => Promise<unknown>): Handler {
  return async (c: Context): Promise<Response> => {
    try {
      const data = await fn(c);
      return c.json({ success: true, data });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg.includes("HTTP 4") ? 400 : 502;
      return c.json({ success: false, error: msg }, status as 400 | 502);
    }
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/", (c) =>
  c.json({
    name: "MovieBox Scraper API",
    version: "1.0.0",
    endpoints: [
      { method: "GET", path: "/search?q=<keyword>&page=1&perPage=20" },
      { method: "GET", path: "/info/:subjectId?se=<season>" },
      { method: "GET", path: "/seasons/:subjectId" },
      { method: "GET", path: "/sources/:subjectId/:se/:ep" },
      { method: "GET", path: "/episodes/:subjectId/:se?page=1&perPage=50" },
      { method: "GET", path: "/trending?type=2" },
      { method: "GET", path: "/trending/community?postNum=3" },
      { method: "GET", path: "/recommend/daily?page=1&perPage=20" },
      { method: "GET", path: "/recommend/related/:subjectId?page=1&perPage=12" },
      { method: "GET", path: "/captions/stream/:subjectId/:streamId" },
      { method: "GET", path: "/captions/ext/:subjectId/:resourceId/:episode" },
      { method: "GET", path: "/dub/:subjectId" },
      { method: "GET", path: "/staff/:staffId" },
      { method: "GET", path: "/staff/:staffId/subjects?start=1&end=20" },
      { method: "GET", path: "/download/:subjectId/:se?resolution=480&epFrom=1&epTo=1" },
      { method: "GET", path: "/download/:subjectId/:se/check?resolution=480&eps=1,2,3" },
      { method: "GET", path: "/stream/:subjectId/:se/:ep?resolution=480  ← HLS proxy (play directly in mpv/VLC)" },
      { method: "GET", path: "/dl/:subjectId/:se/:ep?resolution=480      ← MP4 download redirect" },
      { method: "GET", path: "/stream/:subjectId/:se/:ep?resolution=480" },
      { method: "GET", path: "/dl/:subjectId/:se/:ep?resolution=480" },
    ],
  })
);

app.get("/search", wrap((c) => {
  const q = c.req.query("q");
  if (!q) throw new Error("Missing required query param: q");
  const page    = Number(c.req.query("page")    ?? 1);
  const perPage = Number(c.req.query("perPage") ?? 20);
  return mb.search(q, page, perPage);
}));

app.get("/info/:subjectId", wrap((c) => {
  const subjectId = param(c, "subjectId");
  const se        = c.req.query("se");
  return mb.getSubject(subjectId, se ? Number(se) : undefined);
}));

app.get("/seasons/:subjectId", wrap((c) => {
  return mb.getSeasonInfo(param(c, "subjectId"));
}));

app.get("/sources/:subjectId/:se/:ep", wrap((c) => {
  const subjectId = param(c, "subjectId");
  const se        = Number(param(c, "se"));
  const ep        = Number(param(c, "ep"));
  return mb.getPlayInfo(subjectId, se, ep);
}));

app.get("/episodes/:subjectId/:se", wrap((c) => {
  const subjectId = param(c, "subjectId");
  const se        = Number(param(c, "se"));
  const page      = Number(c.req.query("page")    ?? 1);
  const perPage   = Number(c.req.query("perPage") ?? 20);
  const all       = Number(c.req.query("all")     ?? 0);
  return mb.getResources(subjectId, se, page, perPage, all);
}));

app.get("/trending", wrap((c) => {
  const type = Number(c.req.query("type") ?? 2);
  return mb.getTrending(type);
}));

app.get("/trending/community", wrap((c) => {
  const postNum = Number(c.req.query("postNum") ?? 3);
  return mb.getCommunityTrending(postNum);
}));

app.get("/recommend/daily", wrap((c) => {
  const page    = Number(c.req.query("page")    ?? 1);
  const perPage = Number(c.req.query("perPage") ?? 20);
  return mb.getDailyRec(page, perPage);
}));

app.get("/recommend/related/:subjectId", wrap((c) => {
  const subjectId = param(c, "subjectId");
  const page      = Number(c.req.query("page")    ?? 1);
  const perPage   = Number(c.req.query("perPage") ?? 12);
  return mb.getRelated(subjectId, page, perPage);
}));

app.get("/captions/stream/:subjectId/:streamId", wrap((c) => {
  const subjectId = param(c, "subjectId");
  const streamId  = param(c, "streamId");
  return mb.getStreamCaptions(subjectId, streamId);
}));

app.get("/captions/ext/:subjectId/:resourceId/:episode", wrap((c) => {
  const subjectId  = param(c, "subjectId");
  const resourceId = param(c, "resourceId");
  const episode    = Number(param(c, "episode"));
  return mb.getExtCaptions(subjectId, resourceId, episode);
}));

app.get("/dub/:subjectId", wrap((c) => {
  return mb.getDubInfo(param(c, "subjectId"));
}));

app.get("/staff/:staffId", wrap((c) => {
  return mb.getStaffInfo(param(c, "staffId"));
}));

app.get("/staff/:staffId/subjects", wrap((c) => {
  const staffId = param(c, "staffId");
  const start   = Number(c.req.query("start") ?? 1);
  const end     = Number(c.req.query("end")   ?? 20);
  return mb.getStaffSubjects(staffId, start, end);
}));

app.get("/download/:subjectId/:se", wrap((c) => {
  const subjectId  = param(c, "subjectId");
  const se         = Number(param(c, "se"));
  const resolution = Number(c.req.query("resolution") ?? 480) as 360 | 480 | 720 | 1080;
  const epFrom     = Number(c.req.query("epFrom")  ?? 1);
  const epTo       = Number(c.req.query("epTo")    ?? epFrom);
  const page       = Number(c.req.query("page")    ?? 1);
  const perPage    = Number(c.req.query("perPage") ?? 20);
  return mb.getDownloadLinks(subjectId, se, resolution, epFrom, epTo, page, perPage);
}));

app.get("/download/:subjectId/:se/check", wrap((c) => {
  const subjectId  = param(c, "subjectId");
  const resolution = Number(c.req.query("resolution") ?? 480) as 360 | 480 | 720 | 1080;
  const epsParam   = c.req.query("eps") ?? "1";
  const episodes   = epsParam.split(",").map(Number);
  return mb.checkDownloadAccess(subjectId, episodes, resolution);
}));

// ── Proxy routes ──────────────────────────────────────────────────────────────

/**
 * GET /stream/:subjectId/:se/:ep?resolution=480
 *
 * Transparent HLS proxy — fetches any .m3u8 or .ts segment from the CloudFront
 * CDN with the required signed cookies and pipes it straight to the client.
 *
 * The ?url= param is used for subsequent segment/playlist requests that the
 * HLS player makes. On the first call omit it and the server will redirect to
 * the proxied master playlist URL.
 *
 * Usage in a player:
 *   mpv "http://localhost:3000/stream/7845473610491125400/1/1?resolution=480"
 */
app.get("/stream/:subjectId/:se/:ep", async (c) => {
  const subjectId  = param(c, "subjectId");
  const se         = Number(param(c, "se"));
  const ep         = Number(param(c, "ep"));
  const resolution = c.req.query("resolution") ?? "480";
  const proxyUrl   = c.req.query("url"); // segment/sub-playlist URL from player

  try {
    const stream = await mb.getStreamWithCookies(subjectId, se, ep, resolution);
    const targetUrl = proxyUrl ?? stream.url;

    // Fetch the HLS content from CDN with cookies
    const { request } = await import("undici");
    const { statusCode, headers, body } = await request(targetUrl, {
      headers: { cookie: stream.cookieHeader },
    });

    if (statusCode >= 400) {
      return c.json({ success: false, error: `CDN returned ${statusCode}` }, 502);
    }

    const ct = headers["content-type"] as string ?? "application/octet-stream";

    // For m3u8 playlists: rewrite segment URLs to route through this proxy
    if (ct.includes("mpegurl") || targetUrl.endsWith(".m3u8")) {
      let text = "";
      for await (const chunk of body) text += chunk.toString();

      // Base URL for relative segment rewriting
      const base = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
      const selfBase = `/stream/${subjectId}/${se}/${ep}?resolution=${resolution}&url=`;

      const rewritten = text
        .split("\n")
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) return line;
          // Absolute URL
          if (trimmed.startsWith("http")) {
            return selfBase + encodeURIComponent(trimmed);
          }
          // Relative URL
          return selfBase + encodeURIComponent(base + trimmed);
        })
        .join("\n");

      return new Response(rewritten, {
        status: 200,
        headers: {
          "content-type": "application/vnd.apple.mpegurl",
          "access-control-allow-origin": "*",
          "cache-control": "no-cache",
        },
      });
    }

    // For .ts segments and other binary: pipe directly
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    const buf = Buffer.concat(chunks);

    return new Response(buf, {
      status: statusCode,
      headers: {
        "content-type": ct,
        "content-length": String(buf.length),
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ success: false, error: msg }, 502);
  }
});

/**
 * GET /dl/:subjectId/:se/:ep?resolution=480
 *
 * Proxies the MP4 file through this server so the CDN IP check passes.
 * The signed URL is IP-bound to the server's outbound IP — a plain redirect
 * would fail when the client's browser hits the CDN from a different IP.
 *
 * Supports HTTP Range requests for resumable downloads:
 *   curl -C - "https://moviebox-api-eight.vercel.app/dl/7845473610491125400/1/1?resolution=720" -o ep.mp4
 *   aria2c "https://moviebox-api-eight.vercel.app/dl/7845473610491125400/1/1?resolution=720"
 */
app.get("/dl/:subjectId/:se/:ep", async (c) => {
  const subjectId  = param(c, "subjectId");
  const se         = Number(param(c, "se"));
  const ep         = Number(param(c, "ep"));
  const resolution = Number(c.req.query("resolution") ?? 480) as 360 | 480 | 720 | 1080;

  try {
    const data = await mb.getDownloadLinks(subjectId, se, resolution, ep, ep) as any;
    const item = (data.list ?? [])[0];
    if (!item?.resourceLink) {
      return c.json({ success: false, error: "No download link found" }, 404);
    }

    const { request } = await import("undici");

    // Forward Range header if client sent one (enables resume)
    const rangeHeader = c.req.header("range");
    const upstreamHeaders: Record<string, string> = {};
    if (rangeHeader) upstreamHeaders["range"] = rangeHeader;

    const { statusCode, headers, body } = await request(item.resourceLink, {
      headers: upstreamHeaders,
    });

    if (statusCode >= 400) {
      return c.json({ success: false, error: `CDN returned ${statusCode}` }, 502);
    }

    const ct          = (headers["content-type"] as string)   ?? "video/mp4";
    const cl          = headers["content-length"] as string   | undefined;
    const cr          = headers["content-range"] as string    | undefined;
    const disposition = `attachment; filename="s${se}e${ep}-${resolution}p.mp4"`;

    const resHeaders: Record<string, string> = {
      "content-type":              ct,
      "content-disposition":       disposition,
      "accept-ranges":             "bytes",
      "access-control-allow-origin": "*",
      "cache-control":             "no-store",
    };
    if (cl) resHeaders["content-length"] = cl;
    if (cr) resHeaders["content-range"]  = cr;

    // 206 Partial Content when serving a range, 200 otherwise
    const status = statusCode === 206 ? 206 : 200;

    return new Response(body as unknown as ReadableStream, {
      status,
      headers: resHeaders,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ success: false, error: msg }, 502);
  }
});
