/**
 * MovieBox API client
 *
 * Wraps https://api6.aoneroom.com/wefeed-mobile-bff/
 * All requests are signed with x-tr-signature (HMAC-MD5).
 *
 * Environment variables:
 *   MB_TOKEN   – Bearer JWT from a real MovieBox session
 *   MB_PROXY   – Optional HTTP proxy, e.g. http://user:pass@host:port
 */

import { request as uRequest, ProxyAgent } from "undici";
import { sign } from "./sign.js";
import type {
  ApiResponse,
  SearchData,
  SeasonInfoData,
  ResourceData,
  PlayInfoData,
  TrendingData,
  StaffInfo,
  RecommendData,
  BottomTabData,
  SubtitleItem,
} from "./types.js";

const BASE = "https://api6.aoneroom.com";
const HOST_PARAM = `host=${encodeURIComponent(BASE)}`;

// ── Static headers ─────────────────────────────────────────────────────────────
// Extracted from APK v4.0.01.0813.03 (version_code 50020121).
// Base URL api6.aoneroom.com and HMAC key are both unchanged from v3.0.16.

const CLIENT_BUILD =
  "1786863422670304777.c58dd77ad46d7d89b4605211013d392f" +
  "-1786863190149921915.2f932bfba072c98c72572c2ecde2b365";

const CLIENT_INFO = JSON.stringify({
  package_name: "com.community.oneroom",
  version_name: "4.0.01.0813.03",   // updated from 3.0.16.0727.03
  version_code: 50020121,            // updated from 50020116
  os: "android",
  os_version: "14",
  install_ch: "google-play",
  device_id: "2634a18e740b105fa3d032f2a0f9a568",
  install_store: "gp",
  gaid: "ca11ecdb-21cc-47a2-9822-19f894c22da5",
  brand: "Redmi",
  model: "23106RN0DA",
  system_language: "en",
  net: "NETWORK_3G",
  region: "NG",
  timezone: "Africa/Lagos",
  sp_code: "62120",
  "X-Child-UID": "",
  "X-Client-Build": CLIENT_BUILD,
  "X-Play-Mode": "2",
  "X-Idle-Data": "1",
  "X-Family-Mode": "0",
  "X-Content-Mode": "0",
});

// Rotating proxy pool for registration calls (avoids IP-based rate-limits on
// get-sms-code). Format: host:port:user:pass. Override all with MB_PROXY env var.
const REGISTRATION_PROXIES = [
  "31.59.20.176:6754:cbjxuiif:9y3vzs5v46eg",
  "31.56.127.193:7684:cbjxuiif:9y3vzs5v46eg",
  "45.38.107.97:6014:cbjxuiif:9y3vzs5v46eg",
  "198.105.121.200:6462:cbjxuiif:9y3vzs5v46eg",
  "64.137.96.74:6641:cbjxuiif:9y3vzs5v46eg",
  "198.23.243.226:6361:cbjxuiif:9y3vzs5v46eg",
  "38.154.185.97:6370:cbjxuiif:9y3vzs5v46eg",
  "84.247.60.125:6095:cbjxuiif:9y3vzs5v46eg",
  "142.111.67.146:5611:cbjxuiif:9y3vzs5v46eg",
  "191.96.254.138:6185:cbjxuiif:9y3vzs5v46eg",
];

// Fallback JWT — registered 2026-08-25, valid until 2026-11-23 (~90 days).
// Override via MB_TOKEN env var, or the client auto-obtains a fresh one via
// getGuestToken() when this expires or when MB_TOKEN is unset and needed.
const FALLBACK_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJ1aWQiOjE0NTQ0MTEwNzM0Nzc2NjAyNDgsInV0cCI6MSwiZXhwIjoxNzk1NDIyMjg2LCJpYXQiOjE3ODc2NDU5ODZ9" +
  ".MnqWulfKlxsiVmGXlBRg7svh9W66Y0whbv240BpHFzk";

// ── Token management ──────────────────────────────────────────────────────────

let _cachedToken: string | null = null;
// Single-flight guard: if a registration is already in progress, queue waiters
// so only one guerrillamail account gets created regardless of how many
// concurrent 406s arrive.
let _guestTokenInflight: Promise<string> | null = null;

/** Return the JWT to use, falling back to auto-registration if needed. */
async function resolveToken(): Promise<string> {
  // A freshly registered token (from a 406-triggered refresh) always wins,
  // even over MB_TOKEN — the env-var token is what caused the 406.
  if (_cachedToken) return _cachedToken;

  const envToken = process.env["MB_TOKEN"];
  if (envToken) return envToken;

  // Check if fallback token is still valid (>1 day remaining)
  const fallbackExp = getFallbackExpiry();
  if (fallbackExp - Date.now() > 86_400_000) return FALLBACK_TOKEN;

  // Fallback expired — get a fresh guest token (single-flight guarded)
  _cachedToken = await getGuestToken();
  return _cachedToken;
}

function getFallbackExpiry(): number {
  try {
    const payload = JSON.parse(
      Buffer.from(FALLBACK_TOKEN.split(".")[1], "base64").toString()
    );
    return payload.exp * 1000;
  } catch {
    return 0;
  }
}

/**
 * Obtain a fresh guest JWT by registering a temporary email account.
 *
 * Flow (from APK v4.0.01.0813.03 — InterfaceC23050a):
 *   1. POST /wefeed-mobile-bff/user-api/get-sms-code  {type:1, authType:1, mail, package_name}
 *   2. (caller provides verification code from inbox)
 *   3. POST /wefeed-mobile-bff/user-api/register      {authType:1, mail, verificationCode, password, package_name}
 *      → response.data.token  (JWT valid ~90 days)
 *
 * This function uses a guerrilla-mail throwaway address to automate step 1→2→3
 * so callers don't need to touch a real inbox.
 *
 * A single-flight guard ensures only one registration runs at a time — concurrent
 * callers (e.g. multiple simultaneous 406s) all await the same in-progress call.
 */
export async function getGuestToken(): Promise<string> {
  // If a registration is already running, wait for it and return its result
  if (_guestTokenInflight) return _guestTokenInflight;

  _guestTokenInflight = _registerGuestAccount().finally(() => {
    _guestTokenInflight = null;
  });
  return _guestTokenInflight;
}

async function _registerGuestAccount(): Promise<string> {
  // Generate fresh device identifiers for each registration to avoid
  // device_id-based rate-limits on get-sms-code.
  const { createHash, randomBytes } = await import("node:crypto");
  const freshDeviceId = randomBytes(16).toString("hex");
  const freshGaid = [4, 2, 2, 2, 6]
    .map((n) => randomBytes(n).toString("hex"))
    .join("-");

  function buildFreshClientInfo(): string {
    return JSON.stringify({
      package_name: "com.community.oneroom",
      version_name: "4.0.01.0813.03",
      version_code: 50020121,
      os: "android",
      os_version: "14",
      install_ch: "google-play",
      device_id: freshDeviceId,
      install_store: "gp",
      gaid: freshGaid,
      brand: "Samsung",
      model: "SM-G991B",
      system_language: "en",
      net: "NETWORK_WIFI",
      region: "NG",
      timezone: "Africa/Lagos",
      sp_code: "62120",
      "X-Child-UID": "",
      "X-Client-Build": CLIENT_BUILD,
      "X-Play-Mode": "2",
      "X-Idle-Data": "1",
      "X-Family-Mode": "0",
      "X-Content-Mode": "0",
    });
  }

  // Build proxy list — MB_PROXY env var overrides the built-in pool.
  const proxyUrls: string[] = process.env["MB_PROXY"]
    ? [process.env["MB_PROXY"]]
    : REGISTRATION_PROXIES.map((raw) => {
        const [host, port, user, pass] = raw.split(":");
        return `http://${user}:${pass}@${host}:${port}`;
      });

  // Shuffle so concurrent restarts spread across proxies
  for (let i = proxyUrls.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [proxyUrls[i], proxyUrls[j]] = [proxyUrls[j], proxyUrls[i]];
  }

  // Get a disposable email once — reused across proxy attempts
  const gmRes = await rawRequest(
    "https://api.guerrillamail.com/ajax.php?f=get_email_address",
    { method: "GET" }
  );
  const { email_addr: email, sid_token: sid } = JSON.parse(gmRes.body) as {
    email_addr: string;
    sid_token: string;
  };

  for (const proxyUrl of proxyUrls) {
    const dispatcher = new ProxyAgent(proxyUrl);
    const freshCI = buildFreshClientInfo();

    async function proxyPost(path: string, body_obj: unknown): Promise<unknown> {
      const url = `${BASE}${path}?${HOST_PARAM}`;
      const bodyStr = JSON.stringify(body_obj);
      const ct = "application/json; charset=utf-8";
      const sig = sign(url, { method: "POST", contentType: ct, body: bodyStr });
      const { statusCode, body: rb } = await uRequest(url, {
        method: "POST",
        dispatcher,
        headers: {
          "x-tr-signature": sig,
          "x-client-info": freshCI,
          "x-client-build": CLIENT_BUILD,
          "user-agent": "okhttp/4.9.3",
          "content-type": ct,
        },
        body: bodyStr,
      });
      let text = "";
      for await (const chunk of rb) text += chunk;
      if (statusCode === 429) throw Object.assign(new Error("429"), { is429: true });
      if (statusCode >= 400) throw new Error(`proxyPost ${path} → HTTP ${statusCode}: ${text.slice(0, 300)}`);
      const json = JSON.parse(text) as ApiResponse<unknown>;
      if (json.code !== 0) throw new Error(`API error ${json.code}: ${json.message}`);
      return json.data;
    }

    try {
      // Step 1 — request registration code (may 429 on this proxy → try next)
      await proxyPost(`/wefeed-mobile-bff/user-api/get-sms-code`, {
        type: 1, authType: 1, mail: email, package_name: "com.community.oneroom",
      });
    } catch (err: any) {
      if (err.is429) {
        console.error(`[moviebox] getGuestToken: 429 on ${proxyUrl}, trying next`);
        continue;
      }
      throw err;
    }

    // Step 2 — poll inbox for the 6-digit verification code (up to 60 s)
    const code = await pollGuerrillaInbox(sid, 60_000);

    // Step 3 — register and receive JWT
    const regData = await proxyPost(`/wefeed-mobile-bff/user-api/register`, {
      authType: 1,
      mail: email,
      verificationCode: code,
      password: "Mb!" + Math.random().toString(36).slice(2, 10),
      package_name: "com.community.oneroom",
    });

    const token = (regData as any)?.token as string;
    if (!token) throw new Error("getGuestToken: no token in register response");

    _cachedToken = token;
    return token;
  }

  throw new Error("getGuestToken: all proxies rate-limited (429)");
}

/** Poll a guerrillamail inbox for the 6-digit MovieBox verification code. */
async function pollGuerrillaInbox(
  sid: string,
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let seq = 0;

  while (Date.now() < deadline) {
    await sleep(5000);
    const res = await rawRequest(
      `https://api.guerrillamail.com/ajax.php?f=check_email&seq=${seq}&sid_token=${sid}`,
      { method: "GET" }
    );
    const data = JSON.parse(res.body) as { list?: Array<{ mail_id: string }> };
    for (const msg of data.list ?? []) {
      const body = await fetchGuerrillaEmail(sid, msg.mail_id);
      const m = body.match(/\b([0-9]{6})\b/);
      if (m) return m[1];
      seq++;
    }
  }
  throw new Error("getGuestToken: timed out waiting for verification email");
}

async function fetchGuerrillaEmail(sid: string, id: string): Promise<string> {
  const r = await rawRequest(
    `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${id}&sid_token=${sid}`,
    { method: "GET" }
  );
  const data = JSON.parse(r.body) as { mail_body?: string };
  return (data.mail_body ?? "").replace(/<[^>]+>/g, " ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

interface RawResult { statusCode: number; body: string }

async function rawRequest(
  url: string,
  opts: { method: string; headers?: Record<string, string>; body?: string }
): Promise<RawResult> {
  const { statusCode, body: rb } = await uRequest(url, {
    method: opts.method,
    headers: opts.headers,
    body: opts.body,
  });
  let text = "";
  for await (const chunk of rb) text += chunk;
  return { statusCode, body: text };
}

function buildHeaders(
  method: string,
  url: string,
  token: string,
  contentType?: string,
  body?: string
): Record<string, string> {
  const sig = sign(url, { method, contentType, body });
  return {
    "x-tr-signature": sig,
    authorization: `Bearer ${token}`,
    "x-client-info": CLIENT_INFO,
    "x-client-build": CLIENT_BUILD,
    "x-play-mode": "2",
    "x-idle-data": "1",
    "x-family-mode": "0",
    "x-content-mode": "0",
    "x-client-status": "1",
    "x-child-uid": "",
    "user-agent": "okhttp/4.9.3",
  };
}

function buildUnauthHeaders(
  method: string,
  url: string,
  contentType?: string,
  body?: string
): Record<string, string> {
  const sig = sign(url, { method, contentType, body });
  return {
    "x-tr-signature": sig,
    "x-client-info": CLIENT_INFO,
    "x-client-build": CLIENT_BUILD,
    "user-agent": "okhttp/4.9.3",
  };
}

async function get<T>(path: string, _retry = false): Promise<T> {
  const url = `${BASE}${path}`;
  const token = await resolveToken();
  const { statusCode, body } = await uRequest(url, {
    method: "GET",
    headers: buildHeaders("GET", url, token),
  });
  let text = "";
  for await (const chunk of body) text += chunk;

  // 406 "find no content" = account lost content access → refresh token and retry once
  if (statusCode === 406 && !_retry) {
    console.error(`[moviebox] 406 on GET ${path} — refreshing token`);
    _cachedToken = await getGuestToken();
    return get<T>(path, true);
  }

  if (statusCode >= 400) {
    throw new Error(`GET ${path} → HTTP ${statusCode}: ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text) as ApiResponse<T>;
  if (json.code !== 0) throw new Error(`API error ${json.code}: ${json.message}`);
  return json.data;
}

async function post<T>(path: string, body: unknown, _retry = false): Promise<T> {
  const ct = "application/json; charset=utf-8";
  const bodyStr = JSON.stringify(body);
  const url = `${BASE}${path}`;
  const token = await resolveToken();
  const { statusCode, body: resBody } = await uRequest(url, {
    method: "POST",
    headers: { ...buildHeaders("POST", url, token, ct, bodyStr), "content-type": ct },
    body: bodyStr,
  });
  let text = "";
  for await (const chunk of resBody) text += chunk;

  // 406 "find no content" = account lost content access → refresh token and retry once
  if (statusCode === 406 && !_retry) {
    console.error(`[moviebox] 406 on POST ${path} — refreshing token`);
    _cachedToken = await getGuestToken();
    return post<T>(path, body, true);
  }

  if (statusCode >= 400) {
    throw new Error(`POST ${path} → HTTP ${statusCode}: ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text) as ApiResponse<T>;
  if (json.code !== 0) throw new Error(`API error ${json.code}: ${json.message}`);
  return json.data;
}

/** POST without Authorization header (used for auth endpoints). */
async function postUnauthenticated<T>(path: string, body: unknown): Promise<T> {
  const ct = "application/json; charset=utf-8";
  const bodyStr = JSON.stringify(body);
  const url = `${BASE}${path}`;
  const { statusCode, body: resBody } = await uRequest(url, {
    method: "POST",
    headers: { ...buildUnauthHeaders("POST", url, ct, bodyStr), "content-type": ct },
    body: bodyStr,
  });
  let text = "";
  for await (const chunk of resBody) text += chunk;
  if (statusCode >= 400) {
    throw new Error(`POST (unauth) ${path} → HTTP ${statusCode}: ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text) as ApiResponse<T>;
  if (json.code !== 0) throw new Error(`API error ${json.code}: ${json.message}`);
  return json.data;
}

// ── API methods ───────────────────────────────────────────────────────────────

/** Search for movies / TV shows by keyword. */
export async function search(
  keyword: string,
  page = 1,
  perPage = 20
): Promise<SearchData> {
  return post<SearchData>(
    `/wefeed-mobile-bff/subject-api/search/v2?${HOST_PARAM}`,
    { keyword, page, perPage }
  );
}

/** Basic metadata for a movie or TV season. se = season number (omit for movies). */
export async function getSubject(
  subjectId: string,
  se?: number
): Promise<unknown> {
  const q = new URLSearchParams({ subjectId });
  if (se !== undefined) q.set("se", String(se));
  return get(`/wefeed-mobile-bff/subject-api/get?${q}`);
}

/** All seasons for a TV show. */
export async function getSeasonInfo(subjectId: string): Promise<SeasonInfoData> {
  return get(
    `/wefeed-mobile-bff/subject-api/season-info?subjectId=${subjectId}`
  );
}

/**
 * Episode list / stream resource catalogue for a season.
 * all=1 fetches everything in one shot.
 */
export async function getResources(
  subjectId: string,
  se: number,
  page = 1,
  perPage = 50,
  all = 0
): Promise<ResourceData> {
  const q = new URLSearchParams({
    subjectId,
    page: String(page),
    perPage: String(perPage),
    all: String(all),
    se: String(se),
    pagerMode: "0",
    resolution: "0",
  });
  return get(`/wefeed-mobile-bff/subject-api/resource?${q}`);
}

/** Stream play-info (actual video URLs) for a specific episode. */
export async function getPlayInfo(
  subjectId: string,
  se: number,
  ep: number
): Promise<PlayInfoData> {
  const q = new URLSearchParams({
    subjectId,
    se: String(se),
    ep: String(ep),
  });
  return get(`/wefeed-mobile-bff/subject-api/play-info?${q}`);
}

export interface StreamInfo {
  url: string;
  resolution: string;
  format: string;
  cookieHeader: string;   // ready-to-use Cookie header value
  cookies: Record<string, string>;
}

/**
 * Get stream URL + parsed CloudFront cookies for a specific episode/resolution.
 * resolution: "480" | "720" | "1080" (default: "480")
 */
export async function getStreamWithCookies(
  subjectId: string,
  se: number,
  ep: number,
  resolution = "480"
): Promise<StreamInfo> {
  const data = await getPlayInfo(subjectId, se, ep) as any;
  const streams: any[] = data.streams ?? [];

  // pick requested resolution, fall back to first available
  const stream =
    streams.find((s: any) => s.resolutions === resolution) ?? streams[0];

  if (!stream) throw new Error("No streams found");

  // parse "Key=Value; Key=Value; ..." into a cookie map
  const cookies: Record<string, string> = {};
  for (const part of (stream.signCookie as string).split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) cookies[k] = v;
  }

  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

  return { url: stream.url, resolution: stream.resolutions, format: stream.format, cookieHeader, cookies };
}

/** Embedded subtitle tracks for a stream. */
export async function getStreamCaptions(
  subjectId: string,
  streamId: string
): Promise<SubtitleItem[]> {
  const q = new URLSearchParams({ subjectId, streamId });
  return get(`/wefeed-mobile-bff/subject-api/get-stream-captions?${q}`);
}

/** External subtitle files for a specific episode resource. */
export async function getExtCaptions(
  subjectId: string,
  resourceId: string,
  episode: number
): Promise<SubtitleItem[]> {
  const q = new URLSearchParams({
    subjectId,
    resourceId,
    episode: String(episode),
  });
  return get(`/wefeed-mobile-bff/subject-api/get-ext-captions?${q}`);
}

/** Dubbing language options for a subject. */
export async function getDubInfo(subjectId: string): Promise<unknown> {
  return get(
    `/wefeed-mobile-bff/subject-api/dub-info?subjectId=${subjectId}`
  );
}

/**
 * Trending / hot content.
 * everyoneSearch=2 (everyone's searches), =1 (trending charts)
 */
export async function getTrending(everyoneSearch = 2): Promise<TrendingData> {
  return get(
    `/wefeed-mobile-bff/subject-api/search-rank?everyoneSearch=${everyoneSearch}`
  );
}

/** Community trending entrance (posts + subjects). */
export async function getCommunityTrending(postNum = 3): Promise<unknown> {
  return get(
    `/wefeed-mobile-bff/community/trending-entrance?postNum=${postNum}`
  );
}

/** Personalised daily movie recommendations. */
export async function getDailyRec(
  page = 1,
  perPage = 20
): Promise<RecommendData> {
  return post<RecommendData>(
    `/wefeed-mobile-bff/subject-api/daily-movie-rec`,
    { page, perPage }
  );
}

/** Related / similar content for a subject. */
export async function getRelated(
  subjectId: string,
  page = 1,
  perPage = 12
): Promise<RecommendData> {
  return post<RecommendData>(`/wefeed-mobile-bff/subject-api/detail-rec`, {
    subjectId,
    page,
    perPage,
  });
}

/** Actor / director profile. */
export async function getStaffInfo(staffId: string): Promise<StaffInfo> {
  return get(
    `/wefeed-mobile-bff/subject-api/staff-info?staffId=${staffId}`
  );
}

/** Titles a staff member has appeared in. */
export async function getStaffSubjects(
  staffId: string,
  start = 1,
  end = 20
): Promise<unknown> {
  const q = new URLSearchParams({
    staffId,
    start: String(start),
    end: String(end),
    pagerMode: "1",
  });
  return get(`/wefeed-mobile-bff/subject-api/staff-subject-list?${q}`);
}

/** Community post count for a subject. */
export async function getPostCount(subjectId: string): Promise<unknown> {
  return get(
    `/wefeed-mobile-bff/post/count/subject?subjectId=${subjectId}`
  );
}

/** App home bottom tab config. */
export async function getBottomTabs(): Promise<BottomTabData> {
  return get(`/wefeed-mobile-bff/subject-api/bottom-tab`);
}

// ── Download-specific methods ─────────────────────────────────────────────────

/**
 * Get download links for a range of episodes in a season.
 * Returns resourceLink (direct MP4 URLs) per episode.
 *
 * @param resolution - 360 | 480 | 720 | 1080
 * @param epFrom / epTo - episode range (1-based)
 */
export async function getDownloadLinks(
  subjectId: string,
  se: number,
  resolution: 360 | 480 | 720 | 1080 = 480,
  epFrom = 1,
  epTo = 1,
  page = 1,
  perPage = 20
): Promise<unknown> {
  const q = new URLSearchParams({
    subjectId,
    se: String(se),
    page: String(page),
    perPage: String(perPage),
    all: "0",
    startPosition: String(epFrom),
    endPosition: String(epTo),
    epFrom: String(epFrom),
    epTo: String(epTo),
    pagerMode: "1",      // 1 = download mode (returns resourceLink)
    resolution: String(resolution),
  });
  return get(`/wefeed-mobile-bff/subject-api/resource?${q}`);
}

/**
 * Check whether the current account has download access for specific episodes.
 * Returns { hasAccess: boolean }
 */
export async function checkDownloadAccess(
  subjectId: string,
  episodes: number[],
  resolution: 360 | 480 | 720 | 1080 = 480
): Promise<unknown> {
  return post(`/wefeed-mobile-bff/vip/check-access`, {
    subjectId,
    entitlementKey: "subject_download",
    entitlementProperty: "free_download_count",
    eps: episodes,
    resolution: String(resolution),
  });
}

/**
 * Register a download server-side (required before the download link is valid).
 *
 * @param items - array of { subjectId, resourceId, episode }
 */
export async function startDownload(
  items: Array<{ subjectId: string; resourceId: string; episode: number }>
): Promise<unknown> {
  return post(`/wefeed-mobile-bff/subject-api/start-download-resource`, { items });
}
