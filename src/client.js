/**
 * MovieBox API client
 * Wraps https://api6.aoneroom.com/wefeed-mobile-bff/
 * Env: MB_TOKEN, MB_PROXY
 *
 * Token strategy (fail-soft):
 *  1) in-memory cache
 *  2) MB_TOKEN env
 *  3) disk cache (.mb_token.json)
 *  4) baked FALLBACK_TOKEN while still valid
 *  5) guest registration (proxies + optional direct) — short timeout, never blocks forever
 */
import { request as uRequest, ProxyAgent } from "undici";
import { sign } from "./sign.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const BASE = "https://api6.aoneroom.com";
/** Secondary GZMovie-shaped mirror (same host Cineverse web uses for homepage) */
const MIRROR_BASE = (
  process.env.MB_MIRROR_BASE || "https://moviebox.davidcyril.name.ng"
).replace(/\/$/, "");
const HOST_PARAM = `host=${encodeURIComponent(BASE)}`;
const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = process.env.MB_TOKEN_FILE || join(__dirname, "..", ".mb_token.json");

const CLIENT_BUILD =
  "1786863422670304777.c58dd77ad46d7d89b4605211013d392f" +
  "-1786863190149921915.2f932bfba072c98c72572c2ecde2b365";

const CLIENT_INFO = JSON.stringify({
  package_name: "com.community.oneroom",
  version_name: "4.0.02.0831.03",
  version_code: 50020126,
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

const FALLBACK_TOKEN =
  process.env.MB_FALLBACK_TOKEN ||
  process.env.MB_TOKEN ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjY3ODg5NDM2NTY5Mzk1NzI1MDQsInV0cCI6MSwiZXhwIjoxODAwMjUyOTI4LCJpYXQiOjE3OTI0NzY2Mjh9.VZQEvsuWTrsAmOaRwTLSOoP-kMBp8sIBTM_uJ-niTwM";


const REQUEST_TIMEOUT_MS = Number(process.env.MB_REQUEST_TIMEOUT_MS || 20_000);
const GUEST_TOTAL_TIMEOUT_MS = Number(process.env.MB_GUEST_TIMEOUT_MS || 25_000);

let _cachedToken = null;
let _cachedClientInfo = null; // must match token used at registration
let _guestTokenInflight = null;
let _lastGuestFailAt = 0;
let _autoRefreshStarted = false;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jwtExpMs(token) {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8")
    );
    return (payload.exp || 0) * 1000;
  } catch {
    try {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64").toString("utf8")
      );
      return (payload.exp || 0) * 1000;
    } catch {
      return 0;
    }
  }
}

function isTokenUsable(token) {
  if (!token || typeof token !== "string") return false;
  const exp = jwtExpMs(token);
  // usable until 1h before expiry
  return !exp || exp - Date.now() > 3_600_000;
}

function loadDiskToken() {
  try {
    if (!existsSync(TOKEN_FILE)) return null;
    const raw = JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
    if (raw?.token && isTokenUsable(raw.token)) {
      return { token: raw.token, clientInfo: raw.clientInfo || null };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveDiskToken(token, clientInfo = null) {
  try {
    writeFileSync(
      TOKEN_FILE,
      JSON.stringify({ token, clientInfo, savedAt: Date.now() }),
      "utf8"
    );
  } catch (e) {
    console.warn("[moviebox] could not persist token:", e?.message || e);
  }
}

function pickStaticToken() {
  if (process.env.MB_TOKEN && isTokenUsable(process.env.MB_TOKEN)) {
    return { token: process.env.MB_TOKEN, clientInfo: process.env.MB_CLIENT_INFO || null };
  }
  const disk = loadDiskToken();
  if (disk) return disk;
  if (isTokenUsable(FALLBACK_TOKEN)) return { token: FALLBACK_TOKEN, clientInfo: null };
  if (process.env.MB_TOKEN) return { token: process.env.MB_TOKEN, clientInfo: null };
  return { token: FALLBACK_TOKEN, clientInfo: null };
}

async function resolveToken() {
  if (_cachedToken && isTokenUsable(_cachedToken)) return _cachedToken;
  const staticTok = pickStaticToken();
  _cachedToken = staticTok.token;
  if (staticTok.clientInfo) _cachedClientInfo = staticTok.clientInfo;
  return _cachedToken;
}

function rememberToken(token, clientInfo = null) {
  if (!token) return;
  _cachedToken = token;
  if (clientInfo) _cachedClientInfo = clientInfo;
  saveDiskToken(token, _cachedClientInfo);
}

function activeClientInfo() {
  return _cachedClientInfo || CLIENT_INFO;
}

/** Public entry — may refresh guest in background; never hangs > GUEST_TOTAL_TIMEOUT_MS */
export async function getGuestToken() {
  if (_guestTokenInflight) return _guestTokenInflight;

  // Cooldown after hard failure (avoid stampede)
  if (Date.now() - _lastGuestFailAt < 60_000 && _cachedToken) {
    return _cachedToken;
  }

  _guestTokenInflight = (async () => {
    try {
      const result = await Promise.race([
        _registerGuestAccount(),
        sleep(GUEST_TOTAL_TIMEOUT_MS).then(() => {
          throw new Error("getGuestToken: timed out waiting for verification email");
        }),
      ]);
      const token = typeof result === "string" ? result : result.token;
      const clientInfo = typeof result === "string" ? null : result.clientInfo;
      rememberToken(token, clientInfo);
      return token;
    } catch (e) {
      _lastGuestFailAt = Date.now();
      console.error("[moviebox] getGuestToken failed:", e?.message || e);
      // Keep serving with static token rather than taking the whole API down
      const fallback = pickStaticToken();
      if (fallback?.token) {
        _cachedToken = fallback.token;
        if (fallback.clientInfo) _cachedClientInfo = fallback.clientInfo;
        return fallback.token;
      }
      throw e;
    } finally {
      _guestTokenInflight = null;
    }
  })();

  return _guestTokenInflight;
}

async function rawRequest(url, opts = {}) {
  const { statusCode, body: rb } = await uRequest(url, {
    method: opts.method || "GET",
    headers: opts.headers,
    body: opts.body,
    dispatcher: opts.dispatcher,
    headersTimeout: REQUEST_TIMEOUT_MS,
    bodyTimeout: REQUEST_TIMEOUT_MS,
    connectTimeout: 12_000,
  });
  let text = "";
  for await (const chunk of rb) text += chunk;
  return { statusCode, body: text };
}

async function pollGuerrillaInbox(sid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let seq = 0;
  while (Date.now() < deadline) {
    await sleep(3000);
    try {
      const res = await rawRequest(
        `https://api.guerrillamail.com/ajax.php?f=check_email&seq=${seq}&sid_token=${encodeURIComponent(sid)}`,
        { method: "GET" }
      );
      const data = JSON.parse(res.body);
      const list = data.list || [];
      for (const mail of list) {
        seq = Math.max(seq, Number(mail.mail_id) || 0);
        const full = await rawRequest(
          `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${mail.mail_id}&sid_token=${encodeURIComponent(sid)}`,
          { method: "GET" }
        );
        const body = full.body || "";
        const m =
          body.match(/\b(\d{4,8})\b/) ||
          body.match(/verification[^0-9]*(\d{4,8})/i) ||
          body.match(/code[^0-9]*(\d{4,8})/i);
        if (m) return m[1];
      }
    } catch (e) {
      console.warn("[moviebox] inbox poll error:", e?.message || e);
    }
  }
  throw new Error("getGuestToken: timed out waiting for verification email");
}

async function getTempEmail() {
  const providers = [
    createTempmailLol,
    createTempMailIo,
    createGuerrillaMail,
    createMailTm,
  ];
  const errors = [];
  for (const create of providers) {
    try {
      const box = await create();
      if (box?.email && box?.waitCode) {
        console.log("[moviebox] temp-mail:", box.name, box.email);
        return box;
      }
    } catch (e) {
      errors.push(`${create.name}: ${e?.message || e}`);
      console.warn("[moviebox] temp-mail provider failed:", create.name, e?.message || e);
    }
  }
  throw new Error(
    "getGuestToken: no temp email provider available — " + errors.join(" | ")
  );
}

/** tempmail.lol — confirmed receiving MovieBox verification emails */
async function createTempmailLol() {
  const res = await rawRequest("https://api.tempmail.lol/v2/inbox/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const j = JSON.parse(res.body);
  if (!j.address || !j.token) throw new Error("tempmail.lol: bad response");
  return {
    name: "tempmail.lol",
    email: j.address,
    waitCode: async (ms) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        await sleep(2500);
        try {
          const inbox = await rawRequest(
            `https://api.tempmail.lol/v2/inbox?token=${encodeURIComponent(j.token)}`
          );
          const data = JSON.parse(inbox.body);
          const list = data.emails || data.messages || [];
          for (const m of list) {
            const body = `${m.subject || ""} ${m.body || ""} ${m.html || ""} ${m.text || ""}`;
            const match =
              body.match(/\b(\d{6})\b/) ||
              body.match(/\b(\d{4,8})\b/) ||
              body.match(/code[^0-9]*(\d{4,8})/i);
            if (match) return match[1];
          }
        } catch {
          /* retry */
        }
      }
      throw new Error("getGuestToken: timed out waiting for verification email");
    },
  };
}

/** temp-mail.io */
async function createTempMailIo() {
  const res = await rawRequest("https://api.internal.temp-mail.io/api/v3/email/new", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const j = JSON.parse(res.body);
  if (!j.email || !j.token) throw new Error("temp-mail.io: bad response");
  return {
    name: "temp-mail.io",
    email: j.email,
    waitCode: async (ms) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        await sleep(2500);
        try {
          const inbox = await rawRequest(
            `https://api.internal.temp-mail.io/api/v3/email/${encodeURIComponent(j.email)}/messages`,
            { headers: { Authorization: j.token } }
          );
          let list = [];
          try {
            list = JSON.parse(inbox.body);
          } catch {
            list = [];
          }
          if (!Array.isArray(list)) list = list?.messages || [];
          for (const m of list) {
            const id = m.id || m._id;
            if (!id) continue;
            const full = await rawRequest(
              `https://api.internal.temp-mail.io/api/v3/message/${id}`,
              { headers: { Authorization: j.token } }
            );
            const match =
              full.body.match(/\b(\d{6})\b/) || full.body.match(/\b(\d{4,8})\b/);
            if (match) return match[1];
          }
        } catch {
          /* retry */
        }
      }
      throw new Error("getGuestToken: timed out waiting for verification email");
    },
  };
}

async function createGuerrillaMail() {
  const gmRes = await rawRequest(
    "https://api.guerrillamail.com/ajax.php?f=get_email_address",
    { method: "GET" }
  );
  const j = JSON.parse(gmRes.body);
  if (!j.email_addr || !j.sid_token) throw new Error("guerrilla: bad response");
  return {
    name: "guerrilla",
    email: j.email_addr,
    waitCode: (ms) => pollGuerrillaInbox(j.sid_token, ms),
  };
}

async function createMailTm() {
  const domRes = await rawRequest("https://api.mail.tm/domains", { method: "GET" });
  const domains = JSON.parse(domRes.body);
  const domain =
    domains["hydra:member"]?.[0]?.domain ||
    domains[0]?.domain ||
    null;
  if (!domain) throw new Error("mail.tm: no domain");
  const login = "mb" + randomBytes(5).toString("hex");
  const password = "Mb!" + randomBytes(5).toString("hex");
  const email = `${login}@${domain}`;
  const acc = await rawRequest("https://api.mail.tm/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: email, password }),
  });
  if (acc.statusCode >= 400) throw new Error(`mail.tm account ${acc.statusCode}`);
  const tokRes = await rawRequest("https://api.mail.tm/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: email, password }),
  });
  const bearer = JSON.parse(tokRes.body).token;
  if (!bearer) throw new Error("mail.tm: no token");
  return {
    name: "mail.tm",
    email,
    waitCode: async (ms) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        await sleep(2500);
        try {
          const msgs = await rawRequest("https://api.mail.tm/messages", {
            headers: { authorization: `Bearer ${bearer}` },
          });
          const list = JSON.parse(msgs.body)["hydra:member"] || [];
          if (list.length) {
            const full = await rawRequest(
              "https://api.mail.tm/messages/" + list[0].id,
              { headers: { authorization: `Bearer ${bearer}` } }
            );
            const match =
              full.body.match(/\b(\d{6})\b/) || full.body.match(/\b(\d{4,8})\b/);
            if (match) return match[1];
          }
        } catch {
          /* retry */
        }
      }
      throw new Error("getGuestToken: timed out waiting for verification email");
    },
  };
}

async function _registerGuestAccount() {
  const freshDeviceId = randomBytes(16).toString("hex");
  const freshGaid = [4, 2, 2, 2, 6]
    .map((n) => randomBytes(n).toString("hex"))
    .join("-");

  function buildFreshClientInfo() {
    return JSON.stringify({
      package_name: "com.community.oneroom",
      version_name: "4.0.02.0831.03",
      version_code: 50020126,
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

  const proxyUrls = process.env.MB_PROXY
    ? [process.env.MB_PROXY]
    : REGISTRATION_PROXIES.map((raw) => {
        const [host, port, user, pass] = raw.split(":");
        return `http://${user}:${pass}@${host}:${port}`;
      });

  for (let i = proxyUrls.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [proxyUrls[i], proxyUrls[j]] = [proxyUrls[j], proxyUrls[i]];
  }

  // Try direct (no proxy) first — many VPS IPs work for registration
  const attempts = [null, ...proxyUrls.slice(0, 5)];

  const { email, waitCode } = await getTempEmail();
  console.log("[moviebox] guest register email:", email);

  let lastErr = null;

  for (const proxyUrl of attempts) {
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
    const freshCI = buildFreshClientInfo();

    async function proxyPost(path, body_obj) {
      const url = `${BASE}${path}?${HOST_PARAM}`;
      const bodyStr = JSON.stringify(body_obj);
      const ct = "application/json; charset=utf-8";
      const sig = sign(url, { method: "POST", contentType: ct, body: bodyStr });
      const { statusCode, body: text } = await rawRequest(url, {
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
      if (statusCode === 429) {
        const err = new Error("429");
        err.is429 = true;
        throw err;
      }
      if (statusCode >= 400) {
        throw new Error(`proxyPost ${path} → HTTP ${statusCode}: ${text.slice(0, 300)}`);
      }
      const json = JSON.parse(text);
      if (json.code !== 0) throw new Error(`API error ${json.code}: ${json.message}`);
      return json.data;
    }

    try {
      await proxyPost(`/wefeed-mobile-bff/user-api/get-sms-code`, {
        type: 1,
        authType: 1,
        mail: email,
        package_name: "com.community.oneroom",
      });

      const code = await waitCode(55_000);

      const regData = await proxyPost(`/wefeed-mobile-bff/user-api/register`, {
        authType: 1,
        mail: email,
        verificationCode: code,
        password: "Mb!" + Math.random().toString(36).slice(2, 10),
        package_name: "com.community.oneroom",
      });

      const token = regData?.token;
      if (!token) throw new Error("getGuestToken: no token in register response");
      console.log("[moviebox] guest register OK via", proxyUrl || "direct");
      return { token, clientInfo: freshCI };
    } catch (err) {
      lastErr = err;
      console.error(
        `[moviebox] register attempt failed (${proxyUrl || "direct"}):`,
        err?.message || err
      );
      if (err.is429) continue;
      // non-429: still try next path (proxy/direct)
      continue;
    }
  }

  throw lastErr || new Error("getGuestToken: all registration attempts failed");
}

function buildHeaders(method, url, token, contentType, body) {
  const sig = sign(url, { method, contentType, body });
  return {
    "x-tr-signature": sig,
    authorization: `Bearer ${token}`,
    "x-client-info": activeClientInfo(),
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


function randomProxyDispatcher() {
  try {
    const raw = REGISTRATION_PROXIES[Math.floor(Math.random() * REGISTRATION_PROXIES.length)];
    if (!raw) return undefined;
    const [host, port, user, pass] = raw.split(":");
    return new ProxyAgent(`http://${user}:${pass}@${host}:${port}`);
  } catch {
    return undefined;
  }
}

async function get(path, _retry = false) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const token = await resolveToken();
  const headers = buildHeaders("GET", url, token);

  const attempts = [undefined]; // direct first
  for (let i = 0; i < 4; i++) {
    const d = randomProxyDispatcher();
    if (d) attempts.push(d);
  }

  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    const dispatcher = attempts[i];
    try {
      const { statusCode, body } = await uRequest(url, {
        method: "GET",
        headers,
        headersTimeout: REQUEST_TIMEOUT_MS,
        bodyTimeout: REQUEST_TIMEOUT_MS,
        connectTimeout: 12_000,
        dispatcher,
      });
      let text = "";
      for await (const chunk of body) text += chunk;

      if (statusCode === 406 || statusCode === 401) {
        lastErr = new Error(`GET ${path} → HTTP ${statusCode}: ${text.slice(0, 200)}`);
        console.warn(`[moviebox] ${statusCode} via ${dispatcher ? "proxy" : "direct"} — try next`);
        if (!_retry && i === 0) {
          getGuestToken().catch(() => {});
        }
        continue;
      }
      if (statusCode >= 400) {
        lastErr = new Error(`GET ${path} → HTTP ${statusCode}: ${text.slice(0, 300)}`);
        // proxy auth errors → try next
        if (statusCode === 407 || statusCode === 502 || statusCode === 503) continue;
        throw lastErr;
      }
      const json = JSON.parse(text);
      if (json.code !== 0) throw new Error(`API error ${json.code}: ${json.message}`);
      return json.data;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/407|Proxy|ECONN|ETIMEDOUT|timeout|socket/i.test(msg)) {
        console.warn("[moviebox] transport fail:", msg.slice(0, 100));
        continue;
      }
      // non-transport: still try next attempt once
      if (i < attempts.length - 1) continue;
      throw e;
    }
  }
  throw lastErr || new Error(`GET ${path} failed all attempts`);
}

async function post(path, body, _retry = false) {
  const ct = "application/json; charset=utf-8";
  const bodyStr = JSON.stringify(body);
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const token = await resolveToken();
  const headers = {
    ...buildHeaders("POST", url, token, ct, bodyStr),
    "content-type": ct,
  };

  const attempts = [undefined];
  for (let i = 0; i < 4; i++) {
    const d = randomProxyDispatcher();
    if (d) attempts.push(d);
  }

  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    const dispatcher = attempts[i];
    try {
      const { statusCode, body: resBody } = await uRequest(url, {
        method: "POST",
        headers,
        body: bodyStr,
        headersTimeout: REQUEST_TIMEOUT_MS,
        bodyTimeout: REQUEST_TIMEOUT_MS,
        connectTimeout: 12_000,
        dispatcher,
      });
      let text = "";
      for await (const chunk of resBody) text += chunk;

      if (statusCode === 406 || statusCode === 401) {
        lastErr = new Error(`POST ${path} → HTTP ${statusCode}: ${text.slice(0, 200)}`);
        continue;
      }
      if (statusCode >= 400) {
        lastErr = new Error(`POST ${path} → HTTP ${statusCode}: ${text.slice(0, 300)}`);
        if (statusCode === 407 || statusCode === 502 || statusCode === 503) continue;
        throw lastErr;
      }
      const json = JSON.parse(text);
      if (json.code !== 0) throw new Error(`API error ${json.code}: ${json.message}`);
      return json.data;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/407|Proxy|ECONN|ETIMEDOUT|timeout|socket/i.test(msg)) continue;
      if (i < attempts.length - 1) continue;
      throw e;
    }
  }
  throw lastErr || new Error(`POST ${path} failed all attempts`);
}


async function mirrorGet(path) {
  const url = `${MIRROR_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const { statusCode, body } = await uRequest(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    headersTimeout: REQUEST_TIMEOUT_MS,
    bodyTimeout: REQUEST_TIMEOUT_MS,
    connectTimeout: 12_000,
  });
  let text = "";
  for await (const chunk of body) text += chunk;
  if (statusCode >= 400) throw new Error(`mirror ${statusCode}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// ─── Public API used by app.js ───────────────────────────────────────────────

export async function search(keyword, page = 1, perPage = 20) {
  try {
    return await post(`/wefeed-mobile-bff/subject-api/search/v2?${HOST_PARAM}`, {
      keyword,
      page,
      perPage,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[moviebox] search upstream failed:", msg.slice(0, 120));
    // Mirror search path: /api/search/:query
    try {
      const mir = await mirrorGet(`/api/search/${encodeURIComponent(keyword)}`);
      if (mir?.status === "success" && mir?.data) {
        return mir.data;
      }
    } catch (me) {
      console.warn("[moviebox] mirror search failed:", me?.message || me);
    }
    // Soft empty — never hang the app/UI on search outage
    return {
      pager: { hasMore: false, page: String(page), perPage, totalCount: 0 },
      items: [],
      results: [],
    };
  }
}


/** Poison force-update ad MovieBox injects into mobile trailer / play-info. */
function isPoisonMediaUrl(url, meta = {}) {
  if (!url || typeof url !== "string") return true;
  if (url.includes("80da52722ee7de7a4303290af6783424")) return true;
  if (url.includes("/other/") && /macdn\.aoneroom\.com/.test(url)) return true;
  const size = Number(meta.size || 0);
  const dur = Number(meta.duration || 0);
  // real trailers live under /media/vone/ and are multi-MB
  if (size > 0 && size < 1_200_000 && dur > 0 && dur < 40) return true;
  return false;
}

/**
 * Official app / H5 detail returns real trailers under media/vone/.
 * Mobile subject-api/get often replaces trailer with the install-ad MP4.
 */
async function fetchH5Trailer(subjectId) {
  const url =
    `https://h5-api.aoneroom.com/wefeed-h5api-bff/detail?subjectId=${encodeURIComponent(subjectId)}`;
  try {
    const { statusCode, body: text } = await rawRequest(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        origin: "https://h5.aoneroom.com",
        referer: "https://h5.aoneroom.com/",
        "user-agent":
          "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      },
    });
    if (statusCode >= 400) return null;
    const json = JSON.parse(text);
    if (json.code !== 0 && json.code !== "0") return null;
    const subject = json?.data?.subject || json?.data || {};
    const trailer = subject.trailer || subject.Trailer;
    if (!trailer) return null;
    // H5 uses videoAddress (camel); mobile uses VideoAddress
    const va = trailer.videoAddress || trailer.VideoAddress || {};
    const u = va.url;
    if (!u || isPoisonMediaUrl(u, va)) return null;
    return {
      VideoAddress: {
        videoId: va.videoId || "",
        definition: va.definition || "",
        url: u,
        duration: va.duration || 0,
        width: va.width || 0,
        height: va.height || 0,
        size: va.size || 0,
        fps: va.fps || 0,
        bitrate: va.bitrate || 0,
        type: va.type || 0,
      },
      cover: trailer.cover || null,
      _source: "h5-detail",
    };
  } catch (e) {
    console.warn("[moviebox] H5 trailer fetch failed:", e?.message || e);
    return null;
  }
}

async function withRealTrailer(subject) {
  if (!subject || typeof subject !== "object") return subject;
  const tr = subject.trailer || subject.Trailer;
  const va = tr?.VideoAddress || tr?.videoAddress || {};
  const url = va.url || "";
  if (url && !isPoisonMediaUrl(url, va)) {
    return subject; // already real
  }
  const sid = subject.subjectId;
  if (!sid) return subject;
  const fixed = await fetchH5Trailer(sid);
  if (!fixed) {
    // strip poison so clients don't play the ad
    if (tr) {
      subject = { ...subject, trailer: null, Trailer: null };
    }
    return subject;
  }
  return { ...subject, trailer: fixed };
}

export async function getSubject(subjectId, se) {
  const q = new URLSearchParams({ subjectId });
  if (se !== undefined) q.set("se", String(se));
  try {
    const subject = await get(`/wefeed-mobile-bff/subject-api/get?${q}`);
    return await withRealTrailer(subject);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Upstream often returns 406 "find no content" for restricted tokens —
    // fall back to the public mirror used by Cineverse web.
    if (msg.includes("406") || msg.includes("401") || msg.includes("timeout")) {
      try {
        const mir = await mirrorGet(`/api/info/${encodeURIComponent(subjectId)}`);
        if (mir?.status === "success" && mir?.data) {
          // Mirror wraps as { subject: {...} } or flat subject
          const subject = mir.data.subject || mir.data;
          if (subject?.subjectId || subject?.title) {
            return await withRealTrailer(subject);
          }
        }
      } catch (me) {
        console.warn("[moviebox] mirror info failed:", me?.message || me);
      }
    }
    throw e;
  }
}

export async function getSeasonInfo(subjectId) {
  return get(`/wefeed-mobile-bff/subject-api/season-info?subjectId=${subjectId}`);
}

export async function getResources(subjectId, se, page = 1, perPage = 50, all = 0) {
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

export async function getPlayInfo(subjectId, se, ep) {
  const q = new URLSearchParams({
    subjectId,
    se: String(se),
    ep: String(ep),
  });
  return get(`/wefeed-mobile-bff/subject-api/play-info?${q}`);
}

export async function getStreamWithCookies(subjectId, se, ep, resolution = "480") {
  const data = await getPlayInfo(subjectId, se, ep);
  const streams = data.streams ?? [];
  const stream =
    streams.find((s) => String(s.resolutions) === String(resolution)) ?? streams[0];
  if (!stream) throw new Error("No streams found");

  const cookies = {};
  for (const part of (stream.signCookie || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) cookies[k] = v;
  }
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

  return {
    url: stream.url,
    resolution: stream.resolutions,
    format: stream.format,
    cookieHeader,
    cookies,
  };
}

export async function getStreamCaptions(subjectId, streamId) {
  const q = new URLSearchParams({ subjectId, streamId: String(streamId) });
  return get(`/wefeed-mobile-bff/subject-api/get-stream-captions?${q}`);
}

export async function getExtCaptions(subjectId, resourceId, episode) {
  const q = new URLSearchParams({
    subjectId,
    resourceId,
    episode: String(episode),
  });
  return get(`/wefeed-mobile-bff/subject-api/get-ext-captions?${q}`);
}

export async function getDubInfo(subjectId) {
  return get(`/wefeed-mobile-bff/subject-api/dub-info?subjectId=${subjectId}`);
}

export async function getTrending(everyoneSearch = 2) {
  return get(
    `/wefeed-mobile-bff/subject-api/search-rank?everyoneSearch=${everyoneSearch}`
  );
}

export async function getCommunityTrending(postNum = 3) {
  return get(
    `/wefeed-mobile-bff/community/trending-entrance?postNum=${postNum}`
  );
}

export async function getDailyRec(page = 1, perPage = 20) {
  return post(`/wefeed-mobile-bff/subject-api/daily-movie-rec`, { page, perPage });
}

export async function getRelated(subjectId, page = 1, perPage = 12) {
  return post(`/wefeed-mobile-bff/subject-api/detail-rec`, {
    subjectId,
    page,
    perPage,
  });
}

export async function getStaffInfo(staffId) {
  return get(`/wefeed-mobile-bff/subject-api/staff-info?staffId=${staffId}`);
}

export async function getStaffSubjects(staffId, start = 1, end = 20) {
  const q = new URLSearchParams({
    staffId,
    start: String(start),
    end: String(end),
    pagerMode: "1",
  });
  return get(`/wefeed-mobile-bff/subject-api/staff-subject-list?${q}`);
}

export async function getPostCount(subjectId) {
  return get(`/wefeed-mobile-bff/post/count/subject?subjectId=${subjectId}`);
}

export async function getBottomTabs() {
  return get(`/wefeed-mobile-bff/subject-api/bottom-tab`);
}


/**
 * PC / movie-box.co play endpoint (H5 BFF).
 * Requests H.264-first via supportCodecs when preferH264=true.
 * Returns raw data: { streams, hls, dash, codecPriority, ... }
 */
export async function getH5Play(subjectId, se = 0, ep = 0, opts = {}) {
  const preferH264 = opts.preferH264 !== false;
  const detailPath = opts.detailPath || "";
  const q = new URLSearchParams({
    subjectId: String(subjectId),
    se: String(se),
    ep: String(ep),
    streamSignType: "1",
  });
  if (detailPath) q.set("detailPath", detailPath);
  if (preferH264) {
    q.set("supportCodecs[h264]", "1");
    q.set("supportCodecs[hevc]", "0");
    q.set("supportCodecs[h265]", "0");
  }
  const url =
    `https://h5-api.aoneroom.com/wefeed-h5api-bff/subject/play?${q.toString()}`;
  const { statusCode, body: text } = await rawRequest(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      origin: "https://movie-box.co",
      referer: "https://movie-box.co/",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "x-client-info": JSON.stringify({ timezone: "Africa/Lagos" }),
    },
  });
  if (statusCode >= 400) {
    throw new Error(`h5 play ${statusCode}: ${String(text).slice(0, 180)}`);
  }
  const json = typeof text === "string" ? JSON.parse(text) : text;
  if (json?.code && json.code !== 0) {
    throw new Error(json.message || `h5 play code ${json.code}`);
  }
  return json?.data ?? json;
}

/**
 * Pick best playable URL from H5 play payload (streams / hls / dash).
 * Prefers non-HEVC paths and h264 codec labels.
 */
export function pickH5PlayUrl(playData, resolution = 480) {
  if (!playData || typeof playData !== "object") return null;
  const buckets = [];
  for (const key of ["streams", "hls", "dash"]) {
    const arr = playData[key];
    if (Array.isArray(arr)) {
      for (const s of arr) buckets.push({ ...s, _bucket: key });
    }
  }
  if (!buckets.length) return null;

  const score = (s) => {
    let n = 0;
    const url = String(s.url || s.playUrl || s.src || "");
    const codec = String(s.codecName || s.codec || s.format || "").toLowerCase();
    const res = Number(s.resolutions || s.resolution || s.height || 0);
    if (/h264|avc/.test(codec)) n += 50;
    if (/hevc|h265/.test(codec)) n -= 40;
    if (url.includes("/h264/") || url.includes("/avc/")) n += 40;
    if (url.includes("/h265/") || url.includes("/hevc/")) n -= 40;
    if (/\.m3u8(\?|$)/i.test(url)) n += 15; // HLS often more desktop-friendly
    if (res) n += Math.max(0, 20 - Math.abs(res - Number(resolution)) / 50);
    return n;
  };

  buckets.sort((a, b) => score(b) - score(a));
  const best = buckets[0];
  const url = best.url || best.playUrl || best.src;
  if (!url) return null;
  return {
    url: String(url),
    codec: best.codecName || best.codec || best.format || null,
    resolution: best.resolutions || best.resolution || resolution,
    format: best.format || (/\.m3u8/i.test(url) ? "HLS" : "MP4"),
    bucket: best._bucket,
    signCookie: best.signCookie || "",
  };
}



/**
 * H5 web download list (old worker style):
 * GET h5.aoneroom.com/wefeed-h5-bff/web/subject/download
 * Returns { downloads: [{ id, url, resolution, size }], ... }
 */
export async function getH5WebDownload(subjectId, se = 0, ep = 0, detailPath = "") {
  const HOST = "https://h5.aoneroom.com";
  const baseH = {
    accept: "application/json",
    "user-agent": "okhttp/4.12.0",
    "x-client-info": '{"timezone":"Africa/Nairobi"}',
    referer: HOST,
    "x-forwarded-for": "1.1.1.1",
    "cf-connecting-ip": "1.1.1.1",
    "x-real-ip": "1.1.1.1",
  };
  // warm session cookie (best-effort)
  try {
    await rawRequest(
      `${HOST}/wefeed-h5-bff/app/get-latest-app-pkgs?app_name=moviebox`,
      { method: "GET", headers: baseH }
    );
  } catch {}
  const refererUrl = detailPath
    ? `https://fmoviesunblocked.net/spa/videoPlayPage/movies/${detailPath}?id=${subjectId}&type=/movie/detail`
    : `https://fmoviesunblocked.net/spa/videoPlayPage/movies/x?id=${subjectId}&type=/movie/detail`;
  const q = new URLSearchParams({
    subjectId: String(subjectId),
    se: String(se),
    ep: String(ep),
  });
  const { statusCode, body: text } = await rawRequest(
    `${HOST}/wefeed-h5-bff/web/subject/download?${q}`,
    {
      method: "GET",
      headers: {
        ...baseH,
        origin: "https://fmoviesunblocked.net",
        referer: refererUrl,
      },
    }
  );
  if (statusCode >= 400) {
    throw new Error(`h5 download ${statusCode}: ${String(text).slice(0, 160)}`);
  }
  const json = typeof text === "string" ? JSON.parse(text) : text;
  return json?.data ?? json;
}

export async function getResourcePositionV2(subjectId, resourceId, resourceNum = 1) {
  const q = new URLSearchParams({
    subjectId,
    resourceId,
    failUrl: "",
    failCode: "",
    resourceNum: String(resourceNum),
    isVip: "false",
  });
  return get(`/wefeed-mobile-bff/subject-api/resource-position/v2?${q}`);
}

export async function checkDownloadAccess(subjectId, episodes, resolution = 480) {
  return post(`/wefeed-mobile-bff/vip/check-access`, {
    subjectId,
    entitlementKey: "subject_download",
    entitlementProperty: "free_download_count",
    eps: episodes,
    resolution: String(resolution),
  });
}

export async function startDownload(items) {
  return post(`/wefeed-mobile-bff/subject-api/start-download-resource`, { items });
}

// Warm token at import time (non-blocking)
{
  const boot = pickStaticToken();
  _cachedToken = boot.token;
  if (boot.clientInfo) _cachedClientInfo = boot.clientInfo;
  console.log(
    "[moviebox] token ready, exp in",
    Math.round((jwtExpMs(_cachedToken) - Date.now()) / 86400000),
    "days"
  );
}

/** Background: obtain a fresh full-access guest token via tempmail.lol etc. */
export function startAutoTokenRefresh() {
  if (_autoRefreshStarted) return;
  _autoRefreshStarted = true;

  const tick = async () => {
    try {
      // Refresh when < 3 days left or we only have the restricted FALLBACK
      const exp = jwtExpMs(_cachedToken);
      const daysLeft = (exp - Date.now()) / 86400000;
      const isFallback = _cachedToken === FALLBACK_TOKEN;
      if (isFallback || daysLeft < 3) {
        console.log("[moviebox] auto-refresh: fetching full guest token…");
        await getGuestToken();
        console.log(
          "[moviebox] auto-refresh done, exp in",
          Math.round((jwtExpMs(_cachedToken) - Date.now()) / 86400000),
          "days"
        );
      }
    } catch (e) {
      console.warn("[moviebox] auto-refresh failed:", e?.message || e);
    }
  };

  // First attempt shortly after boot, then daily
  setTimeout(tick, 5_000);
  setInterval(tick, 24 * 60 * 60 * 1000);
}

// Auto-start when loaded as server client
startAutoTokenRefresh();
