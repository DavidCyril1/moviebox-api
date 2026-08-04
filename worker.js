// Cloudflare Worker for MovieBox API with HTTP Proxy Support and Domain Restrictions
// UPDATED: Cookie pool rotation, dynamic IP/UA headers, LIMIT_EXCEED handling

// Allowed domains list - ONLY these domains can access the API
const ALLOWED_DOMAINS = [
    'cineverse.sbs',
    'sbs.cineverse.sbs',
    'moviex.name.ng',
    'sbs9.cineverse.sbs',
    'localhost',
    '127.0.0.1',
    '::1',
    '0.0.0.0',
    'moviexdownloadv3.abrahamdw882.workers.dev',
    'moviexdownload.rajakamal0225.workers.dev',
    'workers.dev',
    'moviexdownload.abtech882t.workers.dev'
];

const MIRROR_HOSTS = [
    "h5.aoneroom.com",
    "movieboxapp.in",
    "moviebox.pk",
    "moviebox.ph",
    "moviebox.id",
    "v.moviebox.ph",
    "netnaija.video"
];

const SELECTED_HOST = "h5.aoneroom.com";
const HOST_URL = `https://${SELECTED_HOST}`;

// Rotating User-Agents pool
const USER_AGENTS = [
    'okhttp/4.12.0',
    'okhttp/4.11.0',
    'okhttp/4.10.0',
    'okhttp/4.9.3',
    'okhttp/4.9.1',
    'okhttp/4.8.0',
    'okhttp/4.7.2',
    'okhttp/4.6.0'
];

const DEFAULT_HEADERS = {
    'X-Client-Info': '{"timezone":"Africa/Nairobi"}',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept': 'application/json',
    'User-Agent': 'okhttp/4.12.0',
    'Referer': HOST_URL,
    'Host': SELECTED_HOST,
    'Connection': 'keep-alive'
};

const SubjectType = {
    ALL: 0,
    MOVIES: 1,
    TV_SERIES: 2,
    MUSIC: 6
};

// Proxy configuration
const PROXY_SOURCES = {
    HTTP: 'https://raw.githubusercontent.com/mauricegift/free-proxies/master/files/http.json',
    COMBINED: 'https://raw.githubusercontent.com/mauricegift/free-proxies/master/files/proxies.json'
};

// Simple ETag generator for Cloudflare Workers (no Buffer needed)
function generateETag(input) {
    if (!input) return '00000000';
    let hash = 0;
    if (input.length === 0) return hash.toString(16).padStart(8, '0');
    
    for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    
    // Convert to hex string and ensure it's at least 8 chars
    const hexHash = Math.abs(hash).toString(16).padStart(8, '0');
    return hexHash;
}

// ─── Cookie Pool ────────────────────────────────────────────────────────────
let cookiePool = [];
let cookiePoolTime = 0;
let cookiePoolIndex = 0;
let cookieRefreshPromise = null;
const POOL_SIZE = 12;
const POOL_TTL = 2700000; // 45 minutes

// ─── Proxy Cache ─────────────────────────────────────────────────────────────
let proxyCache = [];
let proxyCacheTime = 0;
const PROXY_CACHE_DURATION = 1800000; // 30 minutes
let proxyFailCount = new Map();
const MAX_FAIL_COUNT = 3;

// ─── Lightweight Response Caches ─────────────────────────────────────────────
const HOME_CACHE_TTL = 60000; // 1 minute
const TRENDING_CACHE_TTL = 45000; // 45 seconds
const SUBJECT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
let homepageCache = { data: null, time: 0 };
const trendingCache = new Map();
const subjectCache = new Map();

// ─── IP / UA Helpers ─────────────────────────────────────────────────────────
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomIP() {
    const ranges = [
        `41.${randInt(100, 200)}.${randInt(0, 255)}.${randInt(1, 254)}`,
        `102.${randInt(0, 100)}.${randInt(0, 255)}.${randInt(1, 254)}`,
        `197.${randInt(100, 250)}.${randInt(0, 255)}.${randInt(1, 254)}`,
        `196.${randInt(0, 200)}.${randInt(0, 255)}.${randInt(1, 254)}`,
        `105.${randInt(0, 200)}.${randInt(0, 255)}.${randInt(1, 254)}`,
        `154.${randInt(0, 200)}.${randInt(0, 255)}.${randInt(1, 254)}`,
        `45.${randInt(0, 100)}.${randInt(0, 255)}.${randInt(1, 254)}`,
        `64.${randInt(0, 200)}.${randInt(0, 255)}.${randInt(1, 254)}`
    ];
    return ranges[Math.floor(Math.random() * ranges.length)];
}

function getRandomUA() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getDynamicHeaders(extra = {}) {
    const ip = getRandomIP();
    return {
        ...DEFAULT_HEADERS,
        'User-Agent': getRandomUA(),
        'X-Forwarded-For': ip,
        'CF-Connecting-IP': ip,
        'X-Real-IP': ip,
        ...extra
    };
}

// ─── Domain Check ─────────────────────────────────────────────────────────────
function isAllowedDomain(request) {
    const origin = request.headers.get('Origin');
    const referer = request.headers.get('Referer');
    const host = request.headers.get('Host');

    if (origin) {
        try {
            const originUrl = new URL(origin);
            if (ALLOWED_DOMAINS.includes(originUrl.hostname)) return true;
        } catch (_) {}
    }

    if (referer) {
        try {
            const refererUrl = new URL(referer);
            if (ALLOWED_DOMAINS.includes(refererUrl.hostname)) return true;
        } catch (_) {}
    }

    if (host) {
        if (
            ALLOWED_DOMAINS.includes(host) ||
            ALLOWED_DOMAINS.some(d => host.endsWith('.' + d))
        ) return true;
    }

    return false;
}

// ─── Cookie Pool ─────────────────────────────────────────────────────────────
async function fetchFreshCookie() {
    try {
        const headers = getDynamicHeaders();
        const response = await fetch(
            `${HOST_URL}/wefeed-h5-bff/app/get-latest-app-pkgs?app_name=moviebox`,
            { headers }
        );

        let setCookieHeaders = [];
        if (typeof response.headers.getSetCookie === 'function') {
            setCookieHeaders = response.headers.getSetCookie();
        } else {
            setCookieHeaders = [...response.headers]
                .filter(([k]) => k.toLowerCase() === 'set-cookie')
                .map(([, v]) => v);
        }

        if (setCookieHeaders.length > 0) {
            return setCookieHeaders.map(c => c.split(';')[0].trim()).join('; ');
        }
    } catch (e) {
        console.error('Cookie fetch failed:', e.message);
    }
    return null;
}

async function refreshCookiePool() {
    if (cookieRefreshPromise) {
        return cookieRefreshPromise;
    }

    cookieRefreshPromise = (async () => {
    console.log('Refreshing cookie pool...');
    const fetches = Array.from({ length: POOL_SIZE }, () => fetchFreshCookie());
    const results = await Promise.allSettled(fetches);
    const fresh = results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);

    if (fresh.length > 0) {
        cookiePool = fresh;
        cookiePoolTime = Date.now();
        cookiePoolIndex = 0;
        console.log(`Cookie pool ready: ${cookiePool.length} sessions`);
    } else {
        console.warn('Cookie pool refresh failed — no sessions fetched');
    }
    })();

    try {
        await cookieRefreshPromise;
    } finally {
        cookieRefreshPromise = null;
    }
}

async function getCookieFromPool() {
    const now = Date.now();
    const needsRefresh = cookiePool.length === 0 || (now - cookiePoolTime) > POOL_TTL;

    if (needsRefresh) {
        await refreshCookiePool();
    }

    if (cookiePool.length === 0) return null;

    // Round-robin
    const cookie = cookiePool[cookiePoolIndex % cookiePool.length];
    cookiePoolIndex++;
    return cookie;
}

function invalidateCookie(cookie) {
    cookiePool = cookiePool.filter(c => c !== cookie);
    console.log(`Removed bad cookie. Pool size: ${cookiePool.length}`);
}

function ensureCookiePoolRefresh(ctx) {
    const needsRefresh = cookiePool.length === 0 || (Date.now() - cookiePoolTime) > POOL_TTL;
    if (needsRefresh && !cookieRefreshPromise) {
        const refreshJob = refreshCookiePool();
        if (ctx?.waitUntil) ctx.waitUntil(refreshJob);
    }
}

// ─── Proxy Helpers ────────────────────────────────────────────────────────────
async function getProxies() {
    const now = Date.now();
    if (proxyCache.length > 0 && (now - proxyCacheTime) < PROXY_CACHE_DURATION) {
        return proxyCache.filter(p => (proxyFailCount.get(p) || 0) < MAX_FAIL_COUNT);
    }

    try {
        const response = await fetch(PROXY_SOURCES.HTTP);
        const data = await response.json();
        proxyCache = data.proxies || [];
        proxyCacheTime = now;
        proxyFailCount.clear();
        console.log(`Fetched ${proxyCache.length} HTTP proxies`);
        return proxyCache;
    } catch (error) {
        console.error('Failed to fetch proxies:', error.message);
        return proxyCache.filter(p => (proxyFailCount.get(p) || 0) < MAX_FAIL_COUNT);
    }
}

async function getRandomProxy() {
    const proxies = await getProxies();
    if (proxies.length === 0) return null;
    const working = proxies.filter(p => (proxyFailCount.get(p) || 0) < MAX_FAIL_COUNT);
    if (working.length === 0) {
        proxyFailCount.clear();
        return proxies[Math.floor(Math.random() * proxies.length)];
    }
    return working[Math.floor(Math.random() * working.length)];
}

function markProxyFailed(proxy) {
    if (!proxy) return;
    const count = (proxyFailCount.get(proxy) || 0) + 1;
    proxyFailCount.set(proxy, count);
    console.log(`Proxy ${proxy} failed (${count}/${MAX_FAIL_COUNT})`);
}

// ─── Core Fetch ───────────────────────────────────────────────────────────────
async function fetchWithProxy(url, options = {}, retryCount = 0) {
    const maxRetries = 3;
    const useProxy = retryCount > 0;

    let proxy = null;
    if (useProxy) {
        proxy = await getRandomProxy();
        if (proxy) console.log(`Using proxy ${proxy} for ${url.substring(0, 50)}...`);
    }

    const headers = { ...getDynamicHeaders(), ...options.headers };

    if (proxy) {
        headers['X-Proxy'] = proxy;
        headers['Via'] = `1.1 ${proxy.split(':')[0]}`;
        const ip = getRandomIP();
        headers['X-Forwarded-For'] = ip;
        headers['CF-Connecting-IP'] = ip;
        headers['X-Real-IP'] = ip;
    }

    const timeoutMs = options.headers && options.headers['Range'] ? 60000 : 30000;

    let timeoutId;
    try {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
            ...options,
            headers,
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status === 416) return response;

        if (!response.ok && response.status >= 500 && retryCount < maxRetries) {
            console.log(`Status ${response.status}, retrying with proxy...`);
            if (proxy) markProxyFailed(proxy);
            await delay(1000 * Math.pow(2, retryCount));
            return fetchWithProxy(url, options, retryCount + 1);
        }

        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        console.error(`Fetch error: ${error.message}`);
        if (proxy) markProxyFailed(proxy);

        if (retryCount < maxRetries) {
            console.log(`Retrying (${retryCount + 1}/${maxRetries})...`);
            await delay(1000 * Math.pow(2, retryCount));
            return fetchWithProxy(url, options, retryCount + 1);
        }
        throw error;
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── API Request ──────────────────────────────────────────────────────────────
async function makeApiRequest(url, options = {}) {
    const useCookie = options.useCookie !== false;
    const cookie = useCookie ? await getCookieFromPool() : null;
    const headers = { ...getDynamicHeaders(), ...options.headers };
    if (cookie) headers['Cookie'] = cookie;

    const { useCookie: _ignoreUseCookie, ...fetchOptions } = options;
    const response = await fetchWithProxy(url, { ...fetchOptions, headers });

    // If we hit a limit error, invalidate this cookie so it won't be reused
    if (response.status === 200) {
        const cloned = response.clone();
        try {
            const json = await cloned.json();
            if (json?.data?.reason === 'LIMIT_EXCEED' || json?.reason === 'LIMIT_EXCEED' || 
                (json?.code === 403 && json?.message === 'invalid region')) {
                if (cookie) invalidateCookie(cookie);
            }
        } catch (_) {}
    }

    return response;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function processApiResponse(data) {
    if (data && data.data) return data.data;
    return data;
}

function sanitizeFilename(filename) {
    if (!filename) return 'video';
    filename = String(filename).replace(/&[a-z]+;/gi, '');
    const charMap = {
        'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a',
        'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
        'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
        'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ø': 'o',
        'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u',
        'ý': 'y', 'ÿ': 'y', 'ñ': 'n', 'ç': 'c', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss'
    };
    filename = filename.replace(/[^a-zA-Z0-9\s\-_]/g, match => charMap[match] || '');
    filename = filename
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/[\s\t]+/g, '_')
        .replace(/[^\w\-_.]/g, '')
        .replace(/_{2,}/g, '_')
        .replace(/^[_.\-]+|[_.\-]+$/g, '');
    return filename || 'video';
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Proxy, Range',
        'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length, Content-Range, Accept-Ranges, X-Proxy-Status'
    };
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
}

function handleUnauthorized() {
    return jsonResponse({
        status: 'error',
        message: 'Access denied. This API can only be accessed from authorized domains.',
        authorized_domains: ALLOWED_DOMAINS
    }, 403);
}

// ─── Endpoints ────────────────────────────────────────────────────────────────
async function handleProxyList(request) {
    const urlObj = new URL(request.url);
    const limit = parseInt(urlObj.searchParams.get('limit')) || 20;
    const proxies = await getProxies();
    const proxyStatus = proxies.slice(0, limit).map(proxy => ({
        proxy,
        status: (proxyFailCount.get(proxy) || 0) < MAX_FAIL_COUNT ? 'active' : 'failed',
        failCount: proxyFailCount.get(proxy) || 0
    }));
    return jsonResponse({
        status: 'success',
        total: proxies.length,
        active: proxies.filter(p => (proxyFailCount.get(p) || 0) < MAX_FAIL_COUNT).length,
        proxies: proxyStatus,
        cacheTime: new Date(proxyCacheTime).toISOString()
    });
}

async function handleProxyTest() {
    const proxy = await getRandomProxy();
    if (!proxy) {
        return jsonResponse({ status: 'error', message: 'No proxies available' }, 503);
    }
    try {
        const ip = getRandomIP();
        const headers = {
            'User-Agent': getRandomUA(),
            'X-Proxy': proxy,
            'X-Forwarded-For': ip
        };
        const response = await fetch('https://api.ipify.org?format=json', { headers });
        const data = await response.json();
        return jsonResponse({ status: 'success', proxy, yourIP: data.ip, headers });
    } catch (error) {
        markProxyFailed(proxy);
        return jsonResponse({ status: 'error', proxy, message: error.message }, 500);
    }
}

async function handleCookiePool() {
    return jsonResponse({
        status: 'success',
        poolSize: cookiePool.length,
        maxPoolSize: POOL_SIZE,
        poolAge: cookiePoolTime ? Math.round((Date.now() - cookiePoolTime) / 1000) + 's' : 'N/A',
        nextRefreshIn: cookiePoolTime
            ? Math.max(0, Math.round((POOL_TTL - (Date.now() - cookiePoolTime)) / 1000)) + 's'
            : '0s'
    });
}

async function handleHomepage() {
    const now = Date.now();
    if (homepageCache.data && (now - homepageCache.time) < HOME_CACHE_TTL) {
        return jsonResponse({ status: 'success', data: homepageCache.data, cached: true });
    }

    const response = await makeApiRequest(`${HOST_URL}/wefeed-h5-bff/web/home`, { useCookie: false });
    const data = await response.json();
    const content = processApiResponse(data);
    homepageCache = { data: content, time: now };
    return jsonResponse({ status: 'success', data: content });
}

async function handleTrending(url) {
    const urlObj = new URL(url);
    const page = parseInt(urlObj.searchParams.get('page')) || 0;
    const perPage = parseInt(urlObj.searchParams.get('perPage')) || 18;
    const cacheKey = `${page}:${perPage}`;
    const cached = trendingCache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.time) < TRENDING_CACHE_TTL) {
        return jsonResponse({ status: 'success', data: cached.data, cached: true });
    }

    const params = new URLSearchParams({ page, perPage, uid: '5591179548772780352' });
    const response = await makeApiRequest(`${HOST_URL}/wefeed-h5-bff/web/subject/trending?${params}`, { useCookie: false });
    const data = await response.json();
    const content = processApiResponse(data);
    trendingCache.set(cacheKey, { data: content, time: now });
    return jsonResponse({ status: 'success', data: content });
}

async function handleSearch(query, url) {
    const urlObj = new URL(url);
    const page = parseInt(urlObj.searchParams.get('page')) || 1;
    const perPage = parseInt(urlObj.searchParams.get('perPage')) || 24;
    const subjectType = parseInt(urlObj.searchParams.get('type')) || SubjectType.ALL;

    const payload = { keyword: query, page, perPage, subjectType };

    const response = await makeApiRequest(`${HOST_URL}/wefeed-h5-bff/web/subject/search`, {
        method: 'POST',
        useCookie: false,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    let content = processApiResponse(data);

    if (subjectType !== SubjectType.ALL && content.items) {
        content.items = content.items.filter(item => item.subjectType === subjectType);
    }

    if (content.items) {
        content.items.forEach(item => {
            if (item.cover?.url) item.thumbnail = item.cover.url;
            if (item.stills?.url && !item.thumbnail) item.thumbnail = item.stills.url;
        });
    }

    return jsonResponse({ status: 'success', data: content });
}

async function handleInfo(movieId) {
    const content = await getSubjectDetail(movieId);
    if (!content) {
        return jsonResponse({ status: 'error', message: 'Failed to fetch movie info' }, 502);
    }

    if (content.subject) {
        if (content.subject.cover?.url) content.subject.thumbnail = content.subject.cover.url;
        if (content.subject.stills?.url && !content.subject.thumbnail)
            content.subject.thumbnail = content.subject.stills.url;
    }

    return jsonResponse({ status: 'success', data: content });
}

async function getSubjectDetail(movieId) {
    const cached = subjectCache.get(movieId);
    const now = Date.now();
    if (cached && (now - cached.time) < SUBJECT_CACHE_TTL) {
        return cached.data;
    }

    const params = new URLSearchParams({ subjectId: movieId });
    const response = await makeApiRequest(`${HOST_URL}/wefeed-h5-bff/web/subject/detail?${params}`, { useCookie: false });
    const data = await response.json();
    const content = processApiResponse(data);
    if (content) {
        subjectCache.set(movieId, { data: content, time: now });
    }
    return content;
}

async function handleSources(movieId, url, request, attempt = 0) {
    const MAX_ATTEMPTS = cookiePool.length || POOL_SIZE;

    const urlObj = new URL(url);
    const season = parseInt(urlObj.searchParams.get('season')) || 0;
    const episode = parseInt(urlObj.searchParams.get('episode')) || 0;

    // Get movie detail path (cached to avoid repeated extra call latency)
    const movieInfo = await getSubjectDetail(movieId);

    const detailPath = movieInfo?.subject?.detailPath;
    if (!detailPath) {
        return jsonResponse({ status: 'error', message: 'Could not get movie detail path' }, 500);
    }

    const refererUrl = `https://fmoviesunblocked.net/spa/videoPlayPage/movies/${detailPath}?id=${movieId}&type=/movie/detail`;
    const params = new URLSearchParams({ subjectId: movieId, se: season, ep: episode });

    const cookie = await getCookieFromPool();
    const headers = {
        ...getDynamicHeaders(),
        'Referer': refererUrl,
        'Origin': 'https://fmoviesunblocked.net'
    };
    if (cookie) headers['Cookie'] = cookie;

    const response = await fetchWithProxy(
        `${HOST_URL}/wefeed-h5-bff/web/subject/download?${params}`,
        { headers }
    );

    const data = await response.json();
    const content = processApiResponse(data);

    // ── Handle rate limit AND invalid region ──
    const isLimitExceeded = content?.reason === 'LIMIT_EXCEED' || content?.code === 400;
    const isInvalidRegion = content?.code === 403 && 
                           (content?.message === 'invalid region' || 
                            content?.reason === 'Forbidden' && content?.message === 'invalid region');
    
    if (isLimitExceeded || isInvalidRegion) {
        if (cookie) invalidateCookie(cookie);
        
        if (isInvalidRegion) {
            console.log(`Invalid region detected for cookie, retrying with different session (attempt ${attempt + 1})...`);
        } else {
            console.log(`LIMIT_EXCEED detected, retrying with different session (attempt ${attempt + 1})...`);
        }

        if (attempt < MAX_ATTEMPTS) {
            await delay(300);
            return handleSources(movieId, url, request, attempt + 1);
        }

        const errorMessage = isInvalidRegion 
            ? 'All sessions are blocked due to region restrictions. Please try again later.'
            : 'All sessions have reached download limit. Please try again later.';
            
        return jsonResponse({
            status: 'error',
            message: errorMessage,
            retryAfter: 300,
            tip: isInvalidRegion 
                ? 'The region block may be temporary. Please wait a few minutes and try again.'
                : 'The download limit resets periodically. Please wait a few minutes.'
        }, 429);
    }

    if (content?.downloads) {
        const title = movieInfo?.subject?.title || 'video';
        const isEpisode = season > 0 && episode > 0;
        const protocol = request.headers.get('x-forwarded-proto') || 'https';
        const host = request.headers.get('host');
        const baseUrl = `${protocol}://${host}`;

        const sources = content.downloads.map(file => {
            const dlParams = new URLSearchParams({
                url: file.url,
                title,
                quality: file.resolution || 'Unknown'
            });
            if (isEpisode) {
                dlParams.append('season', season);
                dlParams.append('episode', episode);
            }
            return {
                id: file.id,
                quality: file.resolution || 'Unknown',
                directUrl: file.url,
                 streamUrl: `${baseUrl}/api/stream?${dlParams.toString()}`,
                downloadUrl: `${baseUrl}/api/download?${dlParams.toString()}`,
                size: file.size,
                format: 'mp4'
            };
        });

        content.processedSources = sources;
    }

    return jsonResponse({ status: 'success', data: content });
}

async function handleStream(url, request) {
    const urlObj = new URL(url);
    const streamUrl = urlObj.searchParams.get('url');

    if (!streamUrl) {
        return jsonResponse({ status: 'error', message: 'Missing stream URL parameter' }, 400);
    }

    const range = request.headers.get('range');
    const fetchHeaders = {
        'User-Agent': getRandomUA(),
        'Referer': 'https://fmoviesunblocked.net/',
        'Origin': 'https://fmoviesunblocked.net'
    };

    // First try to get file info with HEAD request
    let fileSize;
    let contentType;
    let acceptRanges;

    try {
        const headResponse = await fetchWithProxy(streamUrl, { method: 'HEAD', headers: fetchHeaders });
        fileSize = parseInt(headResponse.headers.get('content-length'));
        contentType = headResponse.headers.get('content-type') || 'video/mp4';
        acceptRanges = headResponse.headers.get('accept-ranges') || 'bytes';

        // If HEAD doesn't give file size, try a small range request
        if (!fileSize || isNaN(fileSize) || fileSize === 0) {
            const rangeResponse = await fetchWithProxy(streamUrl, {
                headers: { ...fetchHeaders, 'Range': 'bytes=0-0' }
            });
            const contentRange = rangeResponse.headers.get('content-range');
            if (contentRange) {
                const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
                if (match) fileSize = parseInt(match[1]);
            }
        }

        if (!fileSize || isNaN(fileSize)) {
            throw new Error('Could not determine file size');
        }
    } catch (error) {
        console.error('Failed to get file info:', error);
        return jsonResponse({ 
            status: 'error', 
            message: 'Could not access video source',
            error: error.message 
        }, 500);
    }

    // Generate ETag using a simple hash function instead of Buffer
    const etag = generateETag(streamUrl);

    // Handle range request
    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        let start = parseInt(parts[0], 10);
        let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        // Handle negative range (last N bytes)
        if (isNaN(start) && !isNaN(end)) {
            start = fileSize - end;
            end = fileSize - 1;
        }

        // Validate range
        if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
            return new Response(null, {
                status: 416,
                headers: {
                    'Content-Range': `bytes */${fileSize}`,
                    ...corsHeaders()
                }
            });
        }

        const chunkSize = end - start + 1;
        
        try {
            const response = await fetchWithProxy(streamUrl, {
                headers: { ...fetchHeaders, 'Range': `bytes=${start}-${end}` }
            });

            if (!response.ok && response.status !== 206) {
                throw new Error(`Failed to fetch range: ${response.status}`);
            }

            return new Response(response.body, {
                status: 206,
                headers: {
                    'Content-Type': contentType,
                    'Content-Length': chunkSize.toString(),
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'no-cache',
                    'ETag': `"${etag}"`,
                    'Last-Modified': new Date().toUTCString(),
                    ...corsHeaders()
                }
            });
        } catch (error) {
            console.error('Range fetch error:', error);
            return jsonResponse({ status: 'error', message: 'Failed to stream video range' }, 500);
        }
    } else {
        // Full file request
        try {
            const response = await fetchWithProxy(streamUrl, { headers: fetchHeaders });

            if (!response.ok) {
                throw new Error(`Failed to fetch video: ${response.status}`);
            }

            return new Response(response.body, {
                status: 200,
                headers: {
                    'Content-Type': contentType,
                    'Content-Length': fileSize.toString(),
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'no-cache',
                    'ETag': `"${etag}"`,
                    'Last-Modified': new Date().toUTCString(),
                    ...corsHeaders()
                }
            });
        } catch (error) {
            console.error('Full fetch error:', error);
            return jsonResponse({ status: 'error', message: 'Failed to stream video' }, 500);
        }
    }
}

async function handleDownload(url, request) {
    const urlObj = new URL(url);
    const downloadUrl = urlObj.searchParams.get('url');
    const title = urlObj.searchParams.get('title') || 'video';
    const season = urlObj.searchParams.get('season');
    const episode = urlObj.searchParams.get('episode');
    const quality = urlObj.searchParams.get('quality') || '';

    if (!downloadUrl) {
        return jsonResponse({ status: 'error', message: 'Missing download URL parameter' }, 400);
    }

    // Generate filename
    let filename = sanitizeFilename(title);
    if (season && episode && season !== '0' && episode !== '0' && season !== 'null' && episode !== 'null') {
        filename += `_S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
    }
    if (quality && quality !== 'Unknown' && quality !== 'null') {
        filename += `_${sanitizeFilename(quality)}`;
    }
    filename += '.mp4';

    const encodedFilename = encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, '%2A');
    const asciiFilename = filename.replace(/[^\x00-\x7F]/g, '_');
    const range = request.headers.get('range');

    const fetchHeaders = {
        'User-Agent': getRandomUA(),
        'Referer': 'https://fmoviesunblocked.net/',
        'Origin': 'https://fmoviesunblocked.net'
    };

    try {
        // Get file info
        let fileSize;
        let contentType;
        let acceptRanges;

        const headResponse = await fetchWithProxy(downloadUrl, { method: 'HEAD', headers: fetchHeaders });
        fileSize = parseInt(headResponse.headers.get('content-length'));
        contentType = headResponse.headers.get('content-type') || 'video/mp4';
        acceptRanges = headResponse.headers.get('accept-ranges') || 'bytes';

        // If HEAD doesn't give file size, try a small range request
        if (!fileSize || isNaN(fileSize) || fileSize === 0) {
            const rangeResponse = await fetchWithProxy(downloadUrl, {
                headers: { ...fetchHeaders, 'Range': 'bytes=0-0' }
            });
            const contentRange = rangeResponse.headers.get('content-range');
            if (contentRange) {
                const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
                if (match) fileSize = parseInt(match[1]);
            }
        }

        if (!fileSize || isNaN(fileSize)) {
            throw new Error('Could not determine file size');
        }

        // Generate ETag using a simple hash function instead of Buffer
        const etag = generateETag(downloadUrl);

        // Prepare response headers
        const responseHeaders = {
            'Content-Type': contentType,
            'Accept-Ranges': acceptRanges,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Content-Disposition': `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
            'ETag': `"${etag}"`,
            'Last-Modified': new Date().toUTCString(),
            'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified, X-Proxy-Status',
            ...corsHeaders()
        };

        // Handle range request (for resumable downloads)
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            let start = parseInt(parts[0], 10);
            let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

            // Handle negative range (last N bytes)
            if (isNaN(start) && !isNaN(end)) {
                start = fileSize - end;
                end = fileSize - 1;
            }

            // Validate range
            if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
                return new Response(null, {
                    status: 416,
                    headers: {
                        'Content-Range': `bytes */${fileSize}`,
                        ...corsHeaders()
                    }
                });
            }

            const chunkSize = end - start + 1;
            
            // Fetch the range with retries
            let retries = 3;
            let response = null;
            let lastError = null;

            while (retries > 0) {
                try {
                    response = await fetchWithProxy(downloadUrl, {
                        headers: { ...fetchHeaders, 'Range': `bytes=${start}-${end}` }
                    });
                    
                    if (response.ok || response.status === 206) {
                        break;
                    }
                    throw new Error(`HTTP ${response.status}`);
                } catch (err) {
                    lastError = err;
                    retries--;
                    if (retries > 0) {
                        console.log(`Range fetch retry, ${retries} attempts left`);
                        await delay(1000);
                    }
                }
            }

            if (!response || (!response.ok && response.status !== 206)) {
                throw new Error(`Failed to fetch range after retries: ${lastError?.message}`);
            }

            responseHeaders['Content-Length'] = chunkSize.toString();
            responseHeaders['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
            
            return new Response(response.body, { 
                status: 206, 
                headers: responseHeaders 
            });

        } else {
            // Full file download
            let retries = 3;
            let response = null;
            let lastError = null;

            while (retries > 0) {
                try {
                    response = await fetchWithProxy(downloadUrl, { headers: fetchHeaders });
                    
                    if (response.ok) {
                        break;
                    }
                    throw new Error(`HTTP ${response.status}`);
                } catch (err) {
                    lastError = err;
                    retries--;
                    if (retries > 0) {
                        console.log(`Full download retry, ${retries} attempts left`);
                        await delay(1000);
                    }
                }
            }

            if (!response || !response.ok) {
                throw new Error(`Failed to fetch file after retries: ${lastError?.message}`);
            }

            responseHeaders['Content-Length'] = fileSize.toString();
            
            return new Response(response.body, { 
                status: 200, 
                headers: responseHeaders 
            });
        }

    } catch (error) {
        console.error('Download error:', error);
        return jsonResponse({
            status: 'error',
            message: 'Download failed',
            error: error.message,
            tip: 'If download was interrupted, try resuming. Your browser should automatically handle this.'
        }, 500);
    }
}

// ─── Homepage HTML ────────────────────────────────────────────────────────────
function getHomePage() {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <link rel="icon" type="image/x-icon" href="https://i.ibb.co/27ymgy5Z/abmoviev1.jpg" />
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta property="og:locale" content="en_US" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Movie API - BY AB-ZTECH" />
    <meta name="keywords" content="Movie, API, Movies, TV Series, Streaming" />
    <meta itemprop="image" content="https://i.ibb.co/27ymgy5Z/abmoviev1.jpg" />
    <meta property="og:image" content="https://i.ibb.co/27ymgy5Z/abmoviev1.jpg" />
    <meta property="og:image:secure_url" content="https://i.ibb.co/27ymgy5Z/abmoviev1.jpg" />
    <meta property="og:image:width" content="650" />
    <meta property="og:image:height" content="350" />
    <title>ABZTECH MovieAPI Documentation</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root {
            --primary: #2196f3;
            --secondary: #2729b0;
            --accent: #e74c3c;
            --background: linear-gradient(45deg, #000428, #004e92);
            --glass: rgba(255, 255, 255, 0.1);
            --success: #2ecc71;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', sans-serif; transition: all 0.2s ease; }
        body { background: var(--background); color: white; min-height: 100vh; line-height: 1.6; }
        .container { max-width: 1200px; margin: 0 auto; padding: 2rem 1rem; }
        .header { text-align: center; margin-bottom: 3rem; }
        .title { font-size: 2.5rem; margin-bottom: 1rem; background: linear-gradient(45deg, #fff, #2196f3); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 700; }
        .tagline { font-size: 1.2rem; opacity: 0.9; max-width: 600px; margin: 0 auto 2rem; color: rgba(255,255,255,0.8); }
        .features-grid { display: grid; gap: 1.5rem; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); margin-bottom: 3rem; }
        .feature-card { background: var(--glass); border-radius: 1rem; padding: 1.5rem; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.2); box-shadow: 0 8px 32px rgba(0,0,0,0.1); text-align: center; }
        .feature-card:hover { transform: translateY(-5px) scale(1.02); box-shadow: 0 12px 40px rgba(0,0,0,0.2); }
        .feature-icon { font-size: 2.5rem; color: var(--primary); margin-bottom: 1rem; }
        .feature-title { font-size: 1.2rem; margin-bottom: 0.75rem; font-weight: 600; }
        .feature-desc { color: rgba(255,255,255,0.8); font-size: 0.95rem; }
        .endpoint-card { background: var(--glass); border-radius: 1rem; overflow: hidden; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.2); box-shadow: 0 8px 32px rgba(0,0,0,0.1); margin-bottom: 2rem; }
        .endpoint-card:hover { transform: translateY(-5px); box-shadow: 0 12px 40px rgba(0,0,0,0.2); }
        .endpoint-header { padding: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; gap: 1rem; }
        .endpoint-icon { width: 50px; height: 50px; background: linear-gradient(45deg, var(--primary), var(--secondary)); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; }
        .endpoint-title { font-size: 1.4rem; font-weight: 600; }
        .endpoint-content { padding: 1.5rem; }
        .endpoint-desc { color: rgba(255,255,255,0.8); margin-bottom: 1.5rem; }
        .status-badge { display: inline-block; background: var(--success); color: white; padding: 5px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: 600; margin-bottom: 1rem; }
        .endpoint-links { display: flex; flex-wrap: wrap; gap: 10px; }
        .endpoint-link { display: inline-block; background: rgba(255,255,255,0.1); color: white; padding: 10px 15px; border-radius: 8px; text-decoration: none; font-size: 0.9rem; border: 1px solid rgba(255,255,255,0.2); }
        .endpoint-link:hover { background: var(--primary); transform: translateY(-2px); }
        .note { background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid var(--accent); }
        code { background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-family: 'Courier New', monospace; color: var(--primary); font-size: 0.9rem; }
        .api-status { text-align: center; margin: 3rem 0; padding: 2rem; background: var(--glass); border-radius: 1rem; backdrop-filter: blur(10px); }
        .api-status h2 { font-size: 1.8rem; margin-bottom: 1rem; background: linear-gradient(45deg, #fff, #2196f3); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .api-status p { color: rgba(255,255,255,0.8); margin-bottom: 1rem; }
        .site-footer { margin-top: 5rem; padding-top: 3rem; border-top: 1px solid rgba(255,255,255,0.1); }
        .footer-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 2rem; margin-bottom: 2rem; }
        .footer-section { padding: 1rem; }
        .footer-title { color: var(--primary); margin-bottom: 1rem; font-size: 1.1rem; }
        .footer-links { list-style: none; }
        .footer-links li { margin-bottom: 0.5rem; }
        .footer-links a { color: rgba(255,255,255,0.8); text-decoration: none; }
        .footer-links a:hover { color: white; text-decoration: underline; }
        .social-links { display: flex; gap: 1rem; margin-top: 1rem; }
        .social-icon { font-size: 1.5rem; color: rgba(255,255,255,0.8); }
        .social-icon:hover { color: var(--primary); }
        .footer-bottom { text-align: center; padding: 2rem 0; border-top: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.7); }
        .legal-links a { color: rgba(255,255,255,0.7); margin: 0 0.5rem; }
        .abztech-logo { color: var(--primary); font-weight: bold; }
        @media (max-width: 768px) {
            .title { font-size: 2rem; }
            .features-grid, .footer-grid { grid-template-columns: 1fr; }
            .footer-section { text-align: center; }
            .social-links { justify-content: center; }
            .endpoint-links { flex-direction: column; }
            .endpoint-link { text-align: center; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <h1 class="title">🎬 ABZTECH Movie API</h1>
            <p class="tagline">Complete access to movies, TV series, and streaming sources</p>
            <div class="features-grid">
                <div class="feature-card">
                    <div class="feature-icon"><i class="fas fa-search"></i></div>
                    <h3 class="feature-title">Real-time Search</h3>
                    <p class="feature-desc">Search for any movie or TV series and get real results from MovieBox database instantly.</p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon"><i class="fas fa-info-circle"></i></div>
                    <h3 class="feature-title">Detailed Information</h3>
                    <p class="feature-desc">Get comprehensive metadata including cast, description, ratings, and more.</p>
                </div>
                <div class="feature-card">
                    <div class="feature-icon"><i class="fas fa-download"></i></div>
                    <h3 class="feature-title">Multiple Quality Downloads</h3>
                    <p class="feature-desc">Access working download links in multiple qualities from 360p to 1080p.</p>
                </div>
            </div>
        </header>

        <div class="main-content">
            <div class="endpoint-card">
                <div class="endpoint-header">
                    <div class="endpoint-icon"><i class="fas fa-home"></i></div>
                    <h2 class="endpoint-title">Homepage Content</h2>
                </div>
                <div class="endpoint-content">
                    <p class="endpoint-desc">Get the latest homepage content from MovieBox including featured movies and recommendations.</p>
                    <span class="status-badge">OPERATIONAL</span>
                    <div class="endpoint-links">
                        <a href="/api/homepage" class="endpoint-link">View Homepage</a>
                    </div>
                </div>
            </div>

            <div class="endpoint-card">
                <div class="endpoint-header">
                    <div class="endpoint-icon"><i class="fas fa-fire"></i></div>
                    <h2 class="endpoint-title">Trending Content</h2>
                </div>
                <div class="endpoint-content">
                    <p class="endpoint-desc">Get currently trending movies and TV series with real-time data from MovieBox.</p>
                    <span class="status-badge">OPERATIONAL</span>
                    <div class="endpoint-links">
                        <a href="/api/trending" class="endpoint-link">View Trending</a>
                    </div>
                </div>
            </div>

            <div class="endpoint-card">
                <div class="endpoint-header">
                    <div class="endpoint-icon"><i class="fas fa-search"></i></div>
                    <h2 class="endpoint-title">Search Movies & TV Series</h2>
                </div>
                <div class="endpoint-content">
                    <p class="endpoint-desc">Search for any movie or TV series and get real results from MovieBox database.</p>
                    <div class="note">
                        <strong>Query Parameters:</strong><br>
                        <code>page</code> - Page number (default: 1)<br>
                        <code>perPage</code> - Results per page (default: 24)<br>
                        <code>type</code> - Content type: 0=All, 1=Movies, 2=TV Series
                    </div>
                    <span class="status-badge">OPERATIONAL</span>
                    <div class="endpoint-links">
                        <a href="/api/search/avatar" class="endpoint-link">Search: Avatar</a>
                        <a href="/api/search/spider-man" class="endpoint-link">Search: Spider-Man</a>
                        <a href="/api/search/wednesday" class="endpoint-link">Search: Wednesday</a>
                    </div>
                </div>
            </div>

            <div class="endpoint-card">
                <div class="endpoint-header">
                    <div class="endpoint-icon"><i class="fas fa-info-circle"></i></div>
                    <h2 class="endpoint-title">Movie Information</h2>
                </div>
                <div class="endpoint-content">
                    <p class="endpoint-desc">Get detailed information about any movie including cast, description, ratings, and metadata.</p>
                    <span class="status-badge">OPERATIONAL</span>
                    <div class="endpoint-links">
                        <a href="/api/info/8906247916759695608" class="endpoint-link">Avatar Info</a>
                        <a href="/api/info/3815343854912427320" class="endpoint-link">Spider-Man Info</a>
                        <a href="/api/info/9028867555875774472" class="endpoint-link">Wednesday Info</a>
                    </div>
                </div>
            </div>

            <div class="endpoint-card">
                <div class="endpoint-header">
                    <div class="endpoint-icon"><i class="fas fa-download"></i></div>
                    <h2 class="endpoint-title">Download Sources</h2>
                </div>
                <div class="endpoint-content">
                    <p class="endpoint-desc">Get real download links with multiple quality options. Automatically rotates sessions to bypass download limits.</p>
                    <div class="note">
                        <strong>For Movies:</strong> Use movie ID only<br>
                        <strong>For TV Episodes:</strong> Add <code>?season=1&amp;episode=1</code>
                    </div>
                    <span class="status-badge">OPERATIONAL</span>
                    <div class="endpoint-links">
                        <a href="/api/sources/8906247916759695608" class="endpoint-link">Avatar Movie</a>
                        <a href="/api/sources/3815343854912427320" class="endpoint-link">Spider-Man Movie</a>
                        <a href="/api/sources/9028867555875774472?season=1&episode=1" class="endpoint-link">Wednesday S1E1</a>
                        <a href="/api/sources/9028867555875774472?season=1&episode=2" class="endpoint-link">Wednesday S1E2</a>
                    </div>
                </div>
            </div>

            <div class="endpoint-card">
                <div class="endpoint-header">
                    <div class="endpoint-icon"><i class="fas fa-play-circle"></i></div>
                    <h2 class="endpoint-title">Video Streaming</h2>
                </div>
                <div class="endpoint-content">
                    <p class="endpoint-desc">Stream videos directly with support for seeking and range requests.</p>
                    <p><strong>Usage:</strong> <code>/api/stream?url=[encoded-video-url]</code></p>
                    <div class="note">Video URLs are provided in the sources endpoint response. Supports HTTP range requests for seeking and resumable playback.</div>
                    <span class="status-badge">OPERATIONAL</span>
                </div>
            </div>

            <div class="endpoint-card">
                <div class="endpoint-header">
                    <div class="endpoint-icon"><i class="fas fa-bolt"></i></div>
                    <h2 class="endpoint-title">Download Proxy</h2>
                </div>
                <div class="endpoint-content">
                    <p class="endpoint-desc">Proxy endpoint that adds proper headers to bypass CDN restrictions with proper filenames and resumable download support.</p>
                    <p><strong>Usage:</strong> <code>/api/download?url=[url]&title=[title]&quality=[quality]</code></p>
                    <div class="note">Supports HTTP range requests for resumable downloads. Your browser will automatically handle download interruptions.</div>
                    <span class="status-badge">OPERATIONAL</span>
                </div>
            </div>

            <div class="endpoint-card">
                <div class="endpoint-header">
                    <div class="endpoint-icon"><i class="fas fa-cookie"></i></div>
                    <h2 class="endpoint-title">Cookie Pool Status</h2>
                </div>
                <div class="endpoint-content">
                    <p class="endpoint-desc">Check the health of the session rotation pool used to bypass download limits.</p>
                    <span class="status-badge">OPERATIONAL</span>
                    <div class="endpoint-links">
                        <a href="/api/cookie-pool" class="endpoint-link">View Pool Status</a>
                    </div>
                </div>
            </div>

            <div class="api-status">
                <h2>API Status</h2>
                <p><strong>All 8 endpoints operational</strong> with real Movie data</p>
                <p>Session pool rotation active — download limits bypassed automatically</p>
                <p><strong>Features:</strong> Real-time search, detailed info, streaming, downloads, trending, session rotation, resumable downloads</p>
            </div>
        </div>

        <footer class="site-footer">
            <div class="footer-grid">
                <div class="footer-section">
                    <h4 class="footer-title">Movie API</h4>
                    <p>Complete access to movies, TV series, and streaming sources</p>
                    <div class="social-links">
                        <a href="https://wa.me/233533763772" class="social-icon"><i class="fab fa-whatsapp"></i></a>
                        <a href="#" class="social-icon"><i class="fab fa-twitter"></i></a>
                        <a href="#" class="social-icon"><i class="fab fa-linkedin"></i></a>
                    </div>
                </div>
                <div class="footer-section">
                    <h4 class="footer-title">Features</h4>
                    <ul class="footer-links">
                        <li><a href="#">Real-time Search</a></li>
                        <li><a href="#">Movie Information</a></li>
                        <li><a href="#">Download Sources</a></li>
                        <li><a href="#">Video Streaming</a></li>
                        <li><a href="#">Trending Content</a></li>
                        <li><a href="#">Session Rotation</a></li>
                        <li><a href="#">Resumable Downloads</a></li>
                    </ul>
                </div>
                <div class="footer-section">
                    <h4 class="footer-title">Legal</h4>
                    <ul class="footer-links">
                        <li><a href="#">Privacy Policy</a></li>
                        <li><a href="#">Terms of Service</a></li>
                        <li><a href="#">DMCA Compliance</a></li>
                        <li><a href="#">Cookie Policy</a></li>
                    </ul>
                </div>
                <div class="footer-section">
                    <h4 class="footer-title">Contact</h4>
                    <ul class="footer-links">
                        <li><a href="https://ab-tech.zone.id">ab-tech.zone.id</a></li>
                        <li><a href="tel:+233533763772">+233533763772</a></li>
                        <li><a href="https://api.whatsapp.com/send/?phone=233533763772" target="_blank">WhatsApp</a></li>
                    </ul>
                </div>
            </div>
            <div class="footer-bottom">
                <p>&copy; 2025 <span class="abztech-logo">ABZTech</span>. All rights reserved.</p>
                <div class="legal-links">
                    <a href="#">Privacy Policy</a> |
                    <a href="#">Terms of Use</a> |
                    <a href="#">Cookie Settings</a>
                </div>
            </div>
        </footer>
    </div>
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('a[href^="#"]').forEach(anchor => {
                anchor.addEventListener('click', function(e) {
                    e.preventDefault();
                    const target = document.querySelector(this.getAttribute('href'));
                    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            });
        });
    </script>
</body>
</html>`;
    return new Response(html, {
        headers: { 'Content-Type': 'text/html', ...corsHeaders() }
    });
}

// ─── Main Router ──────────────────────────────────────────────────────────────
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        ensureCookiePoolRefresh(ctx);

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders() });
        }

        // Domain check
        if (!isAllowedDomain(request)) {
            return handleUnauthorized();
        }

        try {
            if (url.pathname === '/') return getHomePage();
            if (url.pathname === '/api/proxies') return await handleProxyList(request);
            if (url.pathname === '/api/proxy/test') return await handleProxyTest();
            if (url.pathname === '/api/cookie-pool') return await handleCookiePool();
            if (url.pathname === '/api/homepage') return await handleHomepage();
            if (url.pathname === '/api/trending') return await handleTrending(request.url);

            if (url.pathname.startsWith('/api/search/')) {
                const query = url.pathname.split('/api/search/')[1];
                return await handleSearch(decodeURIComponent(query), request.url);
            }

            if (url.pathname.startsWith('/api/info/')) {
                const movieId = url.pathname.split('/api/info/')[1];
                return await handleInfo(movieId);
            }

            if (url.pathname.startsWith('/api/sources/')) {
                const movieId = url.pathname.split('/api/sources/')[1];
                return await handleSources(movieId, request.url, request);
            }

            if (url.pathname === '/api/stream') return await handleStream(request.url, request);
            if (url.pathname === '/api/download') return await handleDownload(request.url, request);

            return jsonResponse({
                status: 'error',
                message: 'Endpoint not found',
                availableEndpoints: [
                    'GET /',
                    'GET /api/proxies',
                    'GET /api/proxy/test',
                    'GET /api/cookie-pool',
                    'GET /api/homepage',
                    'GET /api/trending',
                    'GET /api/search/:query',
                    'GET /api/info/:movieId',
                    'GET /api/sources/:movieId',
                    'GET /api/stream?url=...',
                    'GET /api/download?url=...&title=...&quality=...'
                ]
            }, 404);

        } catch (error) {
            console.error('Worker error:', error);
            return jsonResponse({
                status: 'error',
                message: 'Internal server error',
                error: error.message
            }, 500);
        }
    }
};
