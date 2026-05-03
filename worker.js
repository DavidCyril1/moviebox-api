// Cloudflare Worker for MovieBox API - Backend: Gifted Movies API v2
// Same response format as original worker maintained

const GIFTED_BASE_URL = "https://movieapi.giftedtech.co.ke/api/v2";
const GIFTED_API_KEY = "gifted_movieapi_789fbud2389889dg8962e098g23d6";

const GIFTED_HEADERS = {
    'Authorization': `Bearer ${GIFTED_API_KEY}`,
    'Accept': 'application/json'
};

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization'
    };
}

function sanitizeFilename(filename) {
    return filename
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, '_')
        .replace(/_{2,}/g, '_')
        .trim();
}

async function giftedFetch(path) {
    const response = await fetch(`${GIFTED_BASE_URL}${path}`, {
        headers: GIFTED_HEADERS
    });
    return response.json();
}

// ─── HOMEPAGE ────────────────────────────────────────────────────────────────
// Original: { status: 'success', data: <homepage content> }
async function handleHomepage() {
    const data = await giftedFetch('/homepage');

    return new Response(JSON.stringify({
        status: 'success',
        data: data
    }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
}

// ─── TRENDING ─────────────────────────────────────────────────────────────────
// Original: { status: 'success', data: <trending content with items array> }
async function handleTrending(url) {
    const urlObj = new URL(url);
    const page = parseInt(urlObj.searchParams.get('page')) || 1;

    const data = await giftedFetch(`/trending`);

    // Map gifted response into original expected shape
    const items = (data?.results?.items || data?.items || []).map(item => ({
        subjectId: item.subjectId || item.id,
        title: item.title,
        subjectType: item.subjectType,
        thumbnail: item.thumbnail || item.cover?.url || item.stills?.url || null,
        cover: item.cover || null,
        stills: item.stills || null,
        releaseDate: item.releaseDate,
        score: item.score,
        ...item
    }));

    const content = {
        items,
        total: data?.results?.total || items.length,
        page: data?.results?.page || page,
        perPage: data?.results?.perPage || items.length
    };

    return new Response(JSON.stringify({
        status: 'success',
        data: content
    }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────
// Original: { status: 'success', data: { items: [...], total, page, perPage } }
async function handleSearch(query, url) {
    const urlObj = new URL(url);
    const page = parseInt(urlObj.searchParams.get('page')) || 1;
    const subjectType = parseInt(urlObj.searchParams.get('type')) || 0;

    const data = await giftedFetch(`/search/${encodeURIComponent(query)}?page=${page}`);

    let items = data?.results?.items || data?.items || [];

    // Apply subjectType filter if not ALL (0)
    if (subjectType !== 0) {
        items = items.filter(item => item.subjectType === subjectType);
    }

    // Ensure thumbnail field is populated (same as original worker)
    items = items.map(item => {
        if (item.cover && item.cover.url && !item.thumbnail) {
            item.thumbnail = item.cover.url;
        }
        if (item.stills && item.stills.url && !item.thumbnail) {
            item.thumbnail = item.stills.url;
        }
        return item;
    });

    const content = {
        items,
        total: data?.results?.total || items.length,
        page: data?.results?.page || page,
        perPage: data?.results?.perPage || items.length
    };

    return new Response(JSON.stringify({
        status: 'success',
        data: content
    }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
}

// ─── INFO ─────────────────────────────────────────────────────────────────────
// Original: { status: 'success', data: { subject: { ...fields, thumbnail } } }
async function handleInfo(movieId) {
    const data = await giftedFetch(`/info/${movieId}`);

    // Gifted API returns results under data.results or data directly
    const subject = data?.results?.subject || data?.subject || data?.results || data;

    // Ensure thumbnail is populated (same as original worker)
    if (subject) {
        if (subject.cover && subject.cover.url && !subject.thumbnail) {
            subject.thumbnail = subject.cover.url;
        }
        if (subject.stills && subject.stills.url && !subject.thumbnail) {
            subject.thumbnail = subject.stills.url;
        }
    }

    const content = {
        subject,
        // pass through any extra keys gifted returns at top level
        ...(data?.results && typeof data.results === 'object' && !data.results.subject
            ? {}
            : {}
        )
    };

    return new Response(JSON.stringify({
        status: 'success',
        data: content
    }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
}

// ─── SOURCES ──────────────────────────────────────────────────────────────────
// Original: {
//   status: 'success',
//   data: {
//     downloads: [...],
//     processedSources: [{ id, quality, directUrl, downloadUrl, streamUrl, size, format }]
//   }
// }
async function handleSources(movieId, url, request) {
    const urlObj = new URL(url);
    const season = urlObj.searchParams.get('season');
    const episode = urlObj.searchParams.get('episode');

    let path = `/sources/${movieId}`;
    if (season) {
        path += `?season=${season}`;
        if (episode) path += `&episode=${episode}`;
    }

    const data = await giftedFetch(path);

    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('host');
    const baseUrl = `${protocol}://${host}`;

    // Gifted returns sources under results.downloads or results directly
    const rawDownloads = data?.results?.downloads || data?.downloads || data?.results || [];

    const title = data?.results?.title || data?.title || 'video';
    const isEpisode = season && episode;

    const downloads = Array.isArray(rawDownloads) ? rawDownloads : [];

    const processedSources = downloads.map(file => {
        const quality = file.resolution || file.quality || 'Unknown';
        const fileUrl = file.url || file.link || '';

        const downloadParams = new URLSearchParams({
            url: fileUrl,
            title,
            quality
        });

        if (isEpisode) {
            downloadParams.append('season', season);
            downloadParams.append('episode', episode);
        }

        return {
            id: file.id || null,
            quality,
            directUrl: fileUrl,
            downloadUrl: `${baseUrl}/api/download?${downloadParams.toString()}`,
            streamUrl: `${baseUrl}/api/stream?url=${encodeURIComponent(fileUrl)}`,
            size: file.size || null,
            format: 'mp4'
        };
    });

    const content = {
        downloads,
        processedSources
    };

    return new Response(JSON.stringify({
        status: 'success',
        data: content
    }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
}

// ─── STREAM ───────────────────────────────────────────────────────────────────
// Proxy stream with range/resumable support — unchanged from original
async function handleStream(url, request) {
    const urlObj = new URL(url);
    const streamUrl = urlObj.searchParams.get('url');

    if (!streamUrl) {
        return new Response(JSON.stringify({ status: 'error', message: 'Missing stream URL' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    }

    const range = request.headers.get('range');

    const headResponse = await fetch(streamUrl, {
        method: 'HEAD',
        headers: { 'User-Agent': 'okhttp/4.12.0' }
    });

    const fileSize = parseInt(headResponse.headers.get('content-length'));
    const contentType = headResponse.headers.get('content-type') || 'video/mp4';

    if (!fileSize || isNaN(fileSize)) {
        return new Response(JSON.stringify({ status: 'error', message: 'Could not determine file size' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    }

    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        let start = parseInt(parts[0], 10);
        let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (isNaN(start) && !isNaN(end)) { start = fileSize - end; end = fileSize - 1; }

        if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
            return new Response(JSON.stringify({ status: 'error', message: 'Range not satisfiable' }), {
                status: 416,
                headers: { 'Content-Range': `bytes */${fileSize}`, 'Content-Type': 'application/json', ...corsHeaders() }
            });
        }

        const chunkSize = (end - start) + 1;
        const response = await fetch(streamUrl, {
            headers: { 'User-Agent': 'okhttp/4.12.0', 'Range': `bytes=${start}-${end}` }
        });

        return new Response(response.body, {
            status: 206,
            headers: {
                'Content-Type': contentType,
                'Content-Length': chunkSize,
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-cache',
                ...corsHeaders()
            }
        });
    } else {
        const response = await fetch(streamUrl, { headers: { 'User-Agent': 'okhttp/4.12.0' } });
        return new Response(response.body, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Length': fileSize,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-cache',
                ...corsHeaders()
            }
        });
    }
}

// ─── DOWNLOAD ─────────────────────────────────────────────────────────────────
// Proxy download with Content-Disposition and range support — unchanged from original
async function handleDownload(url, request) {
    const urlObj = new URL(url);
    const downloadUrl = urlObj.searchParams.get('url');
    const title = urlObj.searchParams.get('title') || 'video';
    const season = urlObj.searchParams.get('season');
    const episode = urlObj.searchParams.get('episode');
    const quality = urlObj.searchParams.get('quality') || '';

    if (!downloadUrl) {
        return new Response(JSON.stringify({ status: 'error', message: 'Missing download URL' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    }

    let filename = sanitizeFilename(title);
    if (season && episode) filename += `_S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
    if (quality) filename += `_${quality}`;
    filename += '.mp4';

    const range = request.headers.get('range');

    const headResponse = await fetch(downloadUrl, {
        method: 'HEAD',
        headers: { 'User-Agent': 'okhttp/4.12.0' }
    });

    const fileSize = parseInt(headResponse.headers.get('content-length'));
    const contentType = headResponse.headers.get('content-type') || 'video/mp4';

    if (!fileSize || isNaN(fileSize)) {
        return new Response(JSON.stringify({ status: 'error', message: 'Could not determine file size' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    }

    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        let start = parseInt(parts[0], 10);
        let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (isNaN(start) && !isNaN(end)) { start = fileSize - end; end = fileSize - 1; }

        if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
            return new Response(JSON.stringify({ status: 'error', message: 'Range not satisfiable' }), {
                status: 416,
                headers: { 'Content-Range': `bytes */${fileSize}`, 'Content-Type': 'application/json', ...corsHeaders() }
            });
        }

        const chunkSize = (end - start) + 1;
        const response = await fetch(downloadUrl, {
            headers: { 'User-Agent': 'okhttp/4.12.0', 'Range': `bytes=${start}-${end}` }
        });

        return new Response(response.body, {
            status: 206,
            headers: {
                'Content-Type': contentType,
                'Content-Length': chunkSize,
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Accept-Ranges': 'bytes',
                ...corsHeaders()
            }
        });
    } else {
        const response = await fetch(downloadUrl, { headers: { 'User-Agent': 'okhttp/4.12.0' } });
        return new Response(response.body, {
            headers: {
                'Content-Type': contentType,
                'Content-Length': fileSize,
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Accept-Ranges': 'bytes',
                ...corsHeaders()
            }
        });
    }
}

// ─── HOMEPAGE HTML ────────────────────────────────────────────────────────────
function getHomePage() {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MovieBox API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #0b1020; }
    .topbar { display: none; }
    .swagger-ui .info .title { color: #e2e8f0; }
    .swagger-ui .info p, .swagger-ui .info li, .swagger-ui .opblock-summary-description { color: #94a3b8; }
    .swagger-ui .scheme-container, .swagger-ui .info, .swagger-ui .opblock, .swagger-ui .models, .swagger-ui .try-out { background: #111827 !important; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      filter: true,
      persistAuthorization: true,
      syntaxHighlight: { activated: true },
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>`;

    return new Response(html, {
        headers: { 'Content-Type': 'text/html', ...corsHeaders() }
    });
}

function getOpenApiSpec() {
    return {
        openapi: '3.0.3',
        info: {
            title: 'MovieBox API',
            version: '1.0.0',
            description: 'Gifted Movies API backend for live testing'
        },
        servers: [{ url: '/' }],
        paths: {
            '/api/homepage': { get: { summary: 'Get homepage content', responses: { '200': { description: 'OK' } } } },
            '/api/trending': { get: { summary: 'Get trending content', parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'OK' } } } },
            '/api/search/{query}': { get: { summary: 'Search movies and TV series', parameters: [{ name: 'query', in: 'path', required: true, schema: { type: 'string' } }, { name: 'page', in: 'query', schema: { type: 'integer' } }, { name: 'type', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'OK' } } } },
            '/api/info/{movieId}': { get: { summary: 'Get detailed information', parameters: [{ name: 'movieId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'OK' } } } },
            '/api/sources/{movieId}': { get: { summary: 'Get streaming sources', parameters: [{ name: 'movieId', in: 'path', required: true, schema: { type: 'string' } }, { name: 'season', in: 'query', schema: { type: 'integer' } }, { name: 'episode', in: 'query', schema: { type: 'integer' } }], responses: { '200': { description: 'OK' } } } }
        }
    };
}

// ─── MAIN ROUTER ──────────────────────────────────────────────────────────────
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders() });
        }

        try {
            if (url.pathname === '/') {
                return getHomePage();
            }

            if (url.pathname === '/openapi.json') {
                return new Response(JSON.stringify(getOpenApiSpec()), { headers: { 'Content-Type': 'application/json', ...corsHeaders() } });
            }

            if (url.pathname === '/api/homepage') {
                return await handleHomepage();
            }

            if (url.pathname === '/api/trending') {
                return await handleTrending(request.url);
            }

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

            if (url.pathname === '/api/stream') {
                return await handleStream(request.url, request);
            }

            if (url.pathname === '/api/download') {
                return await handleDownload(request.url, request);
            }

            return new Response(JSON.stringify({
                status: 'error',
                message: 'Endpoint not found',
                availableEndpoints: [
                    'GET /api/homepage',
                    'GET /api/trending',
                    'GET /api/search/:query',
                    'GET /api/info/:movieId',
                    'GET /api/sources/:movieId',
                    'GET /api/stream?url=...',
                    'GET /api/download?url=...'
                ]
            }), {
                status: 404,
                headers: { 'Content-Type': 'application/json', ...corsHeaders() }
            });

        } catch (error) {
            return new Response(JSON.stringify({
                status: 'error',
                message: 'Internal server error',
                error: error.message
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders() }
            });
        }
    }
};
