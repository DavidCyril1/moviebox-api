import { Hono } from "hono";
import * as mb from "./client.js";

export const app = new Hono();

/** Short-lived resolve cache so repeat plays start faster */
const _resolveCache = new Map();
const RESOLVE_TTL_MS = 10 * 60 * 1000;
function cacheGet(key) {
  const hit = _resolveCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    _resolveCache.delete(key);
    return null;
  }
  return hit.val;
}
function cacheSet(key, val) {
  _resolveCache.set(key, { val, exp: Date.now() + RESOLVE_TTL_MS });
  if (_resolveCache.size > 200) {
    const first = _resolveCache.keys().next().value;
    _resolveCache.delete(first);
  }
}


function param(c, name) {
  const v = c.req.param(name);
  if (v === undefined) throw new Error(`Missing route param: ${name}`);
  return v;
}

function wrap(fn) {
  return async (c) => {
    try {
      const data = await fn(c);
      return c.json({ success: true, data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg.includes("HTTP 4") ? 400 : 502;
      return c.json({ success: false, error: msg }, status);
    }
  };
}

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
      { method: "GET", path: "/download/:subjectId/:se/check?resolution=480&eps=1,2,3" },
      { method: "GET", path: "/stream/:subjectId/:se/:ep?resolution=480  ← CDN-safe proxied MP4 (inline, often HEVC/mobile)" },
      { method: "GET", path: "/dl/:subjectId/:se/:ep?resolution=480  ← CDN-safe proxied MP4 (download)" },
      { method: "GET", path: "/pipe/:subjectId/:se/:ep?resolution=480  ← same proxy as /stream (compat)" },
      { method: "GET", path: "/stream-web/:subjectId/:se/:ep?resolution=480  ← movie-box.co H5 play, H.264-first, proxied" },
      { method: "GET", path: "/dl-web/:subjectId/:se/:ep?resolution=480  ← same as stream-web, attachment" },
      { method: "GET", path: "/health  ← self-test search + info + sources + download" },
      { method: "GET", path: "/status  ← alias of /health" },
    ],
  })
);


/**
 * GET /health  (alias: /status, /diagnose)
 * Self-test: search + info + sources + download-link resolve.
 * Returns a plain status so you can see what is fucked without guessing.
 */
async function runSelfCheck() {
  const INCEPTION = "6391474290696802080";
  const started = Date.now();
  const checks = {};

  // --- search ---
  try {
    const t0 = Date.now();
    const data = await mb.search("inception", 1, 5);
    const results = data?.results || [];
    let hits = 0;
    for (const r of results) hits += (r?.subjects || []).length;
    if (!hits && Array.isArray(data?.items)) hits = data.items.filter((x) => x?.subjectId).length;
    checks.search = {
      ok: hits > 0,
      ms: Date.now() - t0,
      hits,
      detail: hits > 0 ? `found ${hits} result(s)` : "search returned empty (token/region/upstream?)",
    };
  } catch (e) {
    checks.search = {
      ok: false,
      ms: null,
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  // --- details / info ---
  try {
    const t0 = Date.now();
    const subject = await mb.getSubject(INCEPTION);
    const title = subject?.title || subject?.subject?.title;
    checks.info = {
      ok: Boolean(title),
      ms: Date.now() - t0,
      title: title || null,
      detail: title ? `got "${title}"` : "info returned no title",
    };
  } catch (e) {
    checks.info = {
      ok: false,
      ms: null,
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  // --- sources / play-info ---
  try {
    const t0 = Date.now();
    const play = await mb.getPlayInfo(INCEPTION, 0, 0);
    const streams = play?.streams || play?.list || [];
    const n = Array.isArray(streams) ? streams.length : 0;
    checks.sources = {
      ok: n > 0,
      ms: Date.now() - t0,
      streams: n,
      detail: n > 0 ? `${n} stream(s)` : "play-info empty (VIP/poison/block?)",
    };
  } catch (e) {
    checks.sources = {
      ok: false,
      ms: null,
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  // --- download URL resolve (signed MP4, not full file transfer) ---
  try {
    const t0 = Date.now();
    const { mp4Url, item } = await resolveRealMp4(INCEPTION, 0, 0, 480);
    const ok = Boolean(mp4Url) && !String(mp4Url).includes("9a0461");
    checks.download = {
      ok,
      ms: Date.now() - t0,
      resolution: item?.resolution ?? 480,
      detail: ok ? "signed MP4 URL resolved" : "no usable download URL",
    };
  } catch (e) {
    checks.download = {
      ok: false,
      ms: null,
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  const order = ["search", "info", "sources", "download"];
  const failed = order.filter((k) => !checks[k]?.ok);
  const passed = order.filter((k) => checks[k]?.ok);
  const allOk = failed.length === 0;
  const noneOk = passed.length === 0;

  let status = "ok";
  let message = "All good — search, details, sources and download resolve are working.";
  if (noneOk) {
    status = "down";
    message =
      "API is fucked — search, details, sources and download all failed. Check token, network, or MovieBox upstream.";
  } else if (failed.length) {
    status = "degraded";
    message = `Partially fucked — working: ${passed.join(", ") || "none"}. Broken: ${failed.join(", ")}.`;
  }

  return {
    status,
    message,
    ok: allOk,
    checkedAt: new Date().toISOString(),
    tookMs: Date.now() - started,
    probe: { subjectId: INCEPTION, query: "inception" },
    checks,
  };
}

app.get("/health", async (c) => {
  const report = await runSelfCheck();
  const http = report.status === "ok" ? 200 : report.status === "degraded" ? 207 : 503;
  return c.json(report, http);
});
app.get("/status", (c) => c.redirect("/health"));
app.get("/diagnose", (c) => c.redirect("/health"));

app.get("/search", wrap((c) => {
  const q = c.req.query("q");
  if (!q) throw new Error("Missing required query param: q");
  const page = Number(c.req.query("page") ?? 1);
  const perPage = Number(c.req.query("perPage") ?? 20);
  return mb.search(q, page, perPage);
}));

app.get("/info/:subjectId", wrap((c) => {
  const subjectId = param(c, "subjectId");
  const se = c.req.query("se");
  return mb.getSubject(subjectId, se ? Number(se) : undefined);
}));

app.get("/seasons/:subjectId", wrap((c) => {
  return mb.getSeasonInfo(param(c, "subjectId"));
}));

app.get("/sources/:subjectId/:se/:ep", wrap((c) => {
  const subjectId = param(c, "subjectId");
  const se = Number(param(c, "se"));
  const ep = Number(param(c, "ep"));
  return mb.getPlayInfo(subjectId, se, ep);
}));

app.get("/episodes/:subjectId/:se", wrap((c) => {
  const subjectId = param(c, "subjectId");
  const se = Number(param(c, "se"));
  const page = Number(c.req.query("page") ?? 1);
  const perPage = Number(c.req.query("perPage") ?? 20);
  const all = Number(c.req.query("all") ?? 0);
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
  const page = Number(c.req.query("page") ?? 1);
  const perPage = Number(c.req.query("perPage") ?? 20);
  return mb.getDailyRec(page, perPage);
}));

app.get("/recommend/related/:subjectId", wrap((c) => {
  const subjectId = param(c, "subjectId");
  const page = Number(c.req.query("page") ?? 1);
  const perPage = Number(c.req.query("perPage") ?? 12);
  return mb.getRelated(subjectId, page, perPage);
}));

app.get("/captions/stream/:subjectId/:streamId", wrap((c) => {
  const subjectId = param(c, "subjectId");
  const streamId = param(c, "streamId");
  return mb.getStreamCaptions(subjectId, streamId);
}));

app.get("/captions/ext/:subjectId/:resourceId/:episode", wrap((c) => {
  const subjectId = param(c, "subjectId");
  const resourceId = param(c, "resourceId");
  const episode = Number(param(c, "episode"));
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
  const start = Number(c.req.query("start") ?? 1);
  const end = Number(c.req.query("end") ?? 20);
  return mb.getStaffSubjects(staffId, start, end);
}));

app.get("/download/:subjectId/:se/check", wrap((c) => {
  const subjectId = param(c, "subjectId");
  const resolution = Number(c.req.query("resolution") ?? 480);
  const epsParam = c.req.query("eps") ?? "1";
  const episodes = epsParam.split(",").map(Number);
  return mb.checkDownloadAccess(subjectId, episodes, resolution);
}));

/** Resolve a real signed MP4 via resource-position/v2 (not poisoned play-info URLs). */
async function resolveRealMp4(subjectId, se, ep, resolution) {
  const ck = `mp4:${subjectId}:${se}:${ep}:${resolution}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  const perPage = 20;
  let page = 1;
  let item = null;
  let scanned = 0;
  let hasMore = true;
  const epCode = se * 100 + ep;

  const pickFrom = (items) => {
    let candidates = items.filter(
      (i) => Number(i.se) === se && Number(i.ep) === ep && Number(i.ep) > 0
    );
    if (candidates.length === 0) {
      candidates = items.filter((i) => Number(i.episode) === epCode && epCode > 0);
    }
    if (candidates.length === 0 && ep > 0) {
      candidates = items.filter(
        (i) => Number(i.ep) === ep && Number(i.se) === se
      );
    }
    const movieItems = items.filter(
      (i) =>
        Number(i.se || 0) === 0 &&
        Number(i.ep || 0) === 0 &&
        Number(i.episode || 0) === 0 &&
        i.resourceId
    );
    if (
      candidates.length === 0 &&
      movieItems.length > 0 &&
      (se === 0 || se === 1) &&
      (ep === 0 || ep === 1)
    ) {
      candidates = movieItems;
    }
    if (candidates.length === 0) return null;
    const isHevc = (i) => {
      const c = String(i.codecName || i.codec || i.format || "").toLowerCase();
      const src = String(i.sourceUrl || i.resourceLink || "").toLowerCase();
      return /hevc|h265/.test(c) || /h265|hevc/.test(src);
    };
    // Prefer non-HEVC (desktop-friendly) when available
    const nonHevc = candidates.filter((i) => !isHevc(i));
    const pool = nonHevc.length ? nonHevc : candidates;
    const exact = pool.find((i) => Number(i.resolution) === resolution);
    if (exact) return exact;
    return pool
      .slice()
      .sort(
        (a, b) =>
          Math.abs(Number(a.resolution) - resolution) -
          Math.abs(Number(b.resolution) - resolution)
      )[0];
  };

  while (hasMore && page <= 40 && !item) {
    const resourceData = await mb.getResources(subjectId, se || 1, page, perPage, 0);
    const items = resourceData.list ?? [];
    scanned += items.length;
    item = pickFrom(items);
    if (item) break;
    const pager = resourceData.pager ?? {};
    hasMore = Boolean(pager.hasMore) || items.length >= perPage;
    page += 1;
    if (items.length === 0) break;
  }

  if (!item && (se === 0 || se === 1) && (ep === 0 || ep === 1)) {
    const resourceData = await mb.getResources(subjectId, 0, 1, perPage, 0);
    const items = resourceData.list ?? [];
    scanned += items.length;
    item = pickFrom(items);
  }

  if (!item?.resourceId) {
    const err = new Error(`No resource found for S${se}E${ep} (scanned ${scanned} items)`);
    err.status = 404;
    throw err;
  }

  const posData = await mb.getResourcePositionV2(subjectId, item.resourceId, 1);
  const mp4Url = (posData?.list ?? [])[0]?.resourceLink;
  if (!mp4Url || mp4Url.includes("9a0461")) {
    const err = new Error("No real stream/download URL found");
    err.status = 404;
    throw err;
  }
  const out = { mp4Url, item, resolution: Number(item.resolution) || resolution };
  cacheSet(ck, out);
  return out;
}

/**
 * Shared CDN-safe MP4 proxy.
 * MovieBox CDN blocks many clients (403/428). We always fetch with okhttp UA
 * (and optional CloudFront cookies) on the server, then pipe bytes to the client.
 * Same URL paths as before — only the response is a real video body instead of a dead 302.
 */
async function proxyMp4(c, { disposition }) {
  const subjectId = param(c, "subjectId");
  const se = Number(param(c, "se"));
  const ep = Number(param(c, "ep"));
  const resolution = Number(c.req.query("resolution") ?? 480);

  const { mp4Url, item } = await resolveRealMp4(subjectId, se, ep, resolution);

  const subjectData = await mb.getSubject(subjectId).catch(() => null);
  const rawTitle = subjectData?.title ?? `Subject-${subjectId}`;
  const title =
    String(rawTitle)
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim() || `Subject-${subjectId}`;

  const isMovie =
    Number(subjectData?.subjectType) === 1 ||
    (Number(item.se || 0) === 0 &&
      Number(item.ep || 0) === 0 &&
      Number(item.episode || 0) === 0);

  const actualRes = Number(item.resolution) || resolution;
  const filename = isMovie
    ? `${title} - ${actualRes}p.mp4`
    : `${title} - S${String(se).padStart(2, "0")}E${String(ep).padStart(2, "0")} - ${actualRes}p.mp4`;

  const { request } = await import("undici");
  const rangeHeader = c.req.header("range");

  let cookieHeader = "";
  try {
    const play = await mb.getPlayInfo(subjectId, se, ep).catch(() => null);
    const streams = play?.streams ?? [];
    const pick =
      streams.find((s) => String(s.resolutions || "").includes(String(actualRes))) ||
      streams[0];
    if (pick?.signCookie) {
      cookieHeader = String(pick.signCookie)
        .split(";")
        .map((p) => p.trim())
        .filter(Boolean)
        .join("; ");
    }
  } catch {
    /* optional */
  }

  const baseHeaders = {
    "user-agent": "okhttp/4.12.0",
    accept: "*/*",
    "accept-encoding": "identity",
  };
  if (rangeHeader) baseHeaders["range"] = rangeHeader;

  async function upstream(extra = {}) {
    // undici 6: maxRedirections on request throws — follow redirects manually
    let url = mp4Url;
    let last;
    for (let hop = 0; hop < 6; hop++) {
      last = await request(url, {
        headers: { ...baseHeaders, ...extra },
        method: "GET",
        bodyTimeout: 0,
        headersTimeout: 60_000,
      });
      if (last.statusCode >= 300 && last.statusCode < 400 && last.headers.location) {
        const loc = last.headers.location;
        url = loc.startsWith("http") ? loc : new URL(loc, url).toString();
        // drain redirect body
        try {
          for await (const _ of last.body) {
            /* discard */
          }
        } catch {
          /* ignore */
        }
        continue;
      }
      return last;
    }
    return last;
  }

  let statusCode, headers, body;
  ({ statusCode, headers, body } = await upstream(
    cookieHeader ? { cookie: cookieHeader } : {},
  ));

  if (statusCode >= 400 && cookieHeader) {
    ({ statusCode, headers, body } = await upstream({}));
  }

  if (statusCode >= 400) {
    const err = new Error(`CDN returned ${statusCode}`);
    err.status = 502;
    throw err;
  }

  const disp =
    disposition === "attachment"
      ? `attachment; filename="${filename}"`
      : `inline; filename="${filename}"`;

  const resHeaders = {
    "content-type": headers["content-type"] ?? "video/mp4",
    "content-disposition": disp,
    "accept-ranges": headers["accept-ranges"] ?? "bytes",
    "access-control-allow-origin": "*",
    "access-control-expose-headers":
      "content-length, content-range, accept-ranges, content-type",
    "cache-control": "no-store",
  };
  if (headers["content-length"]) {
    resHeaders["content-length"] = String(headers["content-length"]);
  }
  if (headers["content-range"]) {
    resHeaders["content-range"] = String(headers["content-range"]);
  }

  return new Response(body, {
    status: statusCode === 206 ? 206 : 200,
    headers: resHeaders,
  });
}

/**
 * GET /stream/:subjectId/:se/:ep?resolution=480
 * CDN-safe playback: streams real MP4 through this server (inline).
 * Same path as before — clients keep the same URL.
 */
app.get("/stream/:subjectId/:se/:ep", async (c) => {
  try {
    // Optional debug: ?redirect=0 was old JSON mode; keep a simple JSON url helper
    if (c.req.query("redirect") === "0") {
      const subjectId = param(c, "subjectId");
      const se = Number(param(c, "se"));
      const ep = Number(param(c, "ep"));
      const resolution = Number(c.req.query("resolution") ?? 480);
      const { mp4Url } = await resolveRealMp4(subjectId, se, ep, resolution);
      return c.json({ success: true, data: { url: mp4Url, resolution } });
    }
    return await proxyMp4(c, { disposition: "inline" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e?.status === 404 ? 404 : e?.status === 502 ? 502 : 502;
    return c.json({ success: false, error: msg }, status);
  }
});

/**
 * GET /dl/:subjectId/:se/:ep?resolution=480
 * CDN-safe download: same path, attachment disposition, proxied bytes.
 */
app.get("/dl/:subjectId/:se/:ep", async (c) => {
  try {
    return await proxyMp4(c, { disposition: "attachment" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e?.status === 404 ? 404 : 502;
    return c.json({ success: false, error: msg }, status);
  }
});

/**
 * GET /pipe/:subjectId/:se/:ep?resolution=480&disposition=inline|attachment
 * Alias of the same proxy (kept for older Cineverse builds that call /pipe).
 */
app.get("/pipe/:subjectId/:se/:ep", async (c) => {
  try {
    const disposition =
      (c.req.query("disposition") ?? "inline").toLowerCase() === "attachment"
        ? "attachment"
        : "inline";
    return await proxyMp4(c, { disposition });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e?.status === 404 ? 404 : 502;
    return c.json({ success: false, error: msg }, status);
  }
});


/**
 * Resolve a desktop-friendlier stream:
 * 1) movie-box.co H5 play API with H.264 preferred (supportCodecs)
 * 2) fallback to existing resource-position MP4 resolver
 */


/** Allow only MovieBox CDN hosts (old worker rule). */
function isAllowedCdnUrl(u) {
  try {
    const h = new URL(u).hostname;
    return (
      /^[a-z0-9-]+\.hakunaymatata\.com$/i.test(h) ||
      /^[a-z0-9-]+\.aoneroom\.com$/i.test(h)
    );
  } catch {
    return false;
  }
}

/**
 * Resolve CDN MP4 for stream-web:
 * 1) H5 web subject/download (old worker)
 * 2) fallback mobile resource-position
 */
async function resolveWebStream(subjectId, se, ep, resolution, opts = {}) {
  const key = `web:${subjectId}:${se}:${ep}:${resolution}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  // --- H5 web download list (optional; often empty / rate-limited) ---
  if (opts.tryH5) {
  try {
    const data = await mb.getH5WebDownload(subjectId, se, ep);
    const downs = data?.downloads || [];
    if (downs.length) {
      const scored = downs
        .filter((f) => f?.url && isAllowedCdnUrl(f.url))
        .map((f) => {
          const res = Number(f.resolution) || 0;
          const url = String(f.url);
          let score = -Math.abs(res - Number(resolution));
          if (/h264|avc/i.test(url) || /h264|avc/i.test(String(f.codecName || f.codec || "")))
            score += 50;
          if (/h265|hevc/i.test(url) || /h265|hevc/i.test(String(f.codecName || f.codec || "")))
            score -= 30;
          return { f, score, res, url };
        })
        .sort((a, b) => b.score - a.score);
      if (scored.length) {
        const best = scored[0];
        const out = {
          url: best.url,
          codec: best.f.codecName || best.f.codec || (best.url.includes("h265") ? "hevc" : "unknown"),
          resolution: best.res || resolution,
          format: "MP4",
          source: "h5-web-download",
          size: best.f.size,
          downloads: downs,
        };
        cacheSet(key, out);
        return out;
      }
    }
  } catch (e) {
    console.warn("[stream-web] H5 download failed:", e?.message || e);
  }
  }

  // --- mobile resource-position fallback ---
  const { mp4Url, item, resolution: res } = await resolveRealMp4(
    subjectId,
    se,
    ep,
    resolution
  );
  const url = mp4Url;
  const codecGuess =
    /h265|hevc/i.test(url) || /hevc|h265/i.test(String(item?.codecName || ""))
      ? "hevc"
      : /h264|avc/i.test(url)
        ? "h264"
        : item?.codecName || item?.codec || "unknown";
  const out = {
    url,
    codec: codecGuess,
    resolution: Number(item?.resolution) || res || resolution,
    format: item?.format || "MP4",
    source: "resource-position",
    item,
  };
  cacheSet(key, out);
  return out;
}

/**
 * Old-worker-style CDN proxy:
 * HEAD for size → parse Range → GET with Range → 206/200 pipe.
 */
async function proxyCdnUrl(c, mediaUrl, { disposition = "inline", filename = "video.mp4", metaHeaders = {} } = {}) {
  if (!mediaUrl || !isAllowedCdnUrl(mediaUrl)) {
    const err = new Error("Invalid or disallowed stream URL");
    err.status = 400;
    throw err;
  }

  const { request } = await import("undici");
  const rangeHeader = c.req.header("range");
  const baseHeaders = {
    "user-agent": "okhttp/4.12.0",
    accept: "*/*",
    "accept-encoding": "identity",
  };
  if (rangeHeader) baseHeaders.range = rangeHeader;

  // Manual redirect follow (undici maxRedirections can break on some CDNs)
  let url = mediaUrl;
  let statusCode, headers, body;
  for (let hop = 0; hop < 6; hop++) {
    const last = await request(url, {
      method: "GET",
      headers: baseHeaders,
      bodyTimeout: 0,
      headersTimeout: 60_000,
    });
    if (last.statusCode >= 300 && last.statusCode < 400 && last.headers.location) {
      const loc = last.headers.location;
      url = loc.startsWith("http") ? loc : new URL(loc, url).toString();
      try {
        for await (const _ of last.body) {
          /* discard */
        }
      } catch {}
      continue;
    }
    statusCode = last.statusCode;
    headers = last.headers;
    body = last.body;
    break;
  }

  if (!statusCode || statusCode >= 400) {
    const err = new Error(`CDN returned ${statusCode || "no-response"}`);
    err.status = 502;
    throw err;
  }

  const disp =
    disposition === "attachment"
      ? `attachment; filename="${filename}"`
      : `inline; filename="${filename}"`;

  const resHeaders = {
    "content-type": headers["content-type"] || "video/mp4",
    "content-disposition": disp,
    "accept-ranges": headers["accept-ranges"] || "bytes",
    "access-control-allow-origin": "*",
    "access-control-expose-headers":
      "content-length, content-range, accept-ranges, content-type, content-disposition, x-stream-codec, x-stream-source",
    "cache-control": "no-store",
    ...metaHeaders,
  };
  if (headers["content-length"]) resHeaders["content-length"] = String(headers["content-length"]);
  if (headers["content-range"]) resHeaders["content-range"] = String(headers["content-range"]);

  return new Response(body, {
    status: statusCode === 206 ? 206 : 200,
    headers: resHeaders,
  });
}

async function proxyWebMedia(c, { disposition }) {
  const subjectId = param(c, "subjectId");
  const se = Number(param(c, "se"));
  const ep = Number(param(c, "ep"));
  const resolution = Number(c.req.query("resolution") ?? 480);

  const resolved = await resolveWebStream(subjectId, se, ep, resolution, {
    tryH5: c.req.query("h5") === "1",
  });
  const mediaUrl = resolved.url;

  const subjectData = await mb.getSubject(subjectId).catch(() => null);
  const rawTitle = subjectData?.title ?? `Subject-${subjectId}`;
  const title =
    String(rawTitle)
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim() || `Subject-${subjectId}`;
  const actualRes = resolved.resolution || resolution;
  const filename = `${title} - S${String(se).padStart(2, "0")}E${String(ep).padStart(2, "0")} - ${actualRes}p.mp4`;

  return proxyCdnUrl(c, mediaUrl, {
    disposition,
    filename,
    metaHeaders: {
      "x-stream-source": String(resolved.source || ""),
      "x-stream-codec": String(resolved.codec || ""),
    },
  });
}

/**
 * GET /stream-web/:subjectId/:se/:ep?resolution=480
 * Resolve (H5 download → mobile fallback) + worker-style CDN proxy.
 */
app.get("/stream-web/:subjectId/:se/:ep", async (c) => {
  try {
    if (c.req.query("redirect") === "0") {
      const subjectId = param(c, "subjectId");
      const se = Number(param(c, "se"));
      const ep = Number(param(c, "ep"));
      const resolution = Number(c.req.query("resolution") ?? 480);
      const resolved = await resolveWebStream(subjectId, se, ep, resolution, {
        tryH5: c.req.query("h5") === "1",
      });
      return c.json({ success: true, data: resolved });
    }
    return await proxyWebMedia(c, { disposition: "inline" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e?.status === 404 ? 404 : e?.status === 400 ? 400 : 502;
    return c.json({ success: false, error: msg }, status);
  }
});

app.get("/dl-web/:subjectId/:se/:ep", async (c) => {
  try {
    return await proxyWebMedia(c, { disposition: "attachment" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e?.status === 404 ? 404 : e?.status === 400 ? 400 : 502;
    return c.json({ success: false, error: msg }, status);
  }
});

/**
 * GET /api/stream?url=...  (old worker compatible thin proxy)
 */
app.get("/api/stream", async (c) => {
  try {
    const streamUrl = c.req.query("url") || "";
    return await proxyCdnUrl(c, streamUrl, {
      disposition: "inline",
      filename: "video.mp4",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e?.status === 400 ? 400 : 502;
    return c.json({ status: "error", message: msg }, status);
  }
});

app.get("/api/download", async (c) => {
  try {
    const downloadUrl = c.req.query("url") || "";
    const title = (c.req.query("title") || "video").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_");
    const quality = c.req.query("quality") || "";
    const season = c.req.query("season");
    const episode = c.req.query("episode");
    let filename = title;
    if (season && episode) {
      filename += `_S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
    }
    if (quality) filename += `_${quality}`;
    filename += ".mp4";
    return await proxyCdnUrl(c, downloadUrl, {
      disposition: "attachment",
      filename,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e?.status === 400 ? 400 : 502;
    return c.json({ status: "error", message: msg }, status);
  }
});

/** Generic CDN URL proxy (HLS segments / manual) */
app.get("/proxy-url", async (c) => {
  try {
    const u = c.req.query("u") || c.req.query("url") || "";
    return await proxyCdnUrl(c, u, { disposition: "inline", filename: "segment.bin" });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 502);
  }
});



app.get("/admin/refresh-token", async (c) => {
  try {
    const before = "ok";
    const token = await mb.getGuestToken();
    const exp = token ? "got" : "empty";
    return c.json({
      success: true,
      tokenPrefix: token ? String(token).slice(0, 24) : null,
      len: token ? String(token).length : 0,
    });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
