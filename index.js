const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5000;

const GIFTED_BASE_URL = 'https://movieapi.giftedtech.co.ke/api/v2';
const GIFTED_API_KEY = 'gifted_movieapi_789fbud2389889dg8962e098g23d6';
const GIFTED_HEADERS = {
  Authorization: `Bearer ${GIFTED_API_KEY}`,
  Accept: 'application/json'
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  };
}

function sanitizeFilename(filename) {
  return filename.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_').replace(/_{2,}/g, '_').trim();
}

async function giftedFetch(path) {
  const response = await axios.get(`${GIFTED_BASE_URL}${path}`, {
    headers: GIFTED_HEADERS,
    timeout: 30000
  });
  return response.data;
}

function mapItem(item) {
  const mapped = { ...item };
  if (!mapped.thumbnail) {
    if (mapped.cover && mapped.cover.url) mapped.thumbnail = mapped.cover.url;
    if (!mapped.thumbnail && mapped.stills && mapped.stills.url) mapped.thumbnail = mapped.stills.url;
  }
  return mapped;
}

function extractResults(data) {
  return data?.results || data || {};
}

function normalizeListResponse(data, page) {
  const results = extractResults(data);
  const items = (results.items || results.subjectList || results.subjects || []).map(mapItem);
  return {
    items,
    total: results.total || items.length,
    page: results.page || page,
    perPage: results.perPage || items.length
  };
}

app.get('/', (req, res) => {
  res.send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>MovieBox API</title></head><body><h1>MovieBox API Server</h1><p>Gifted Movies API backend</p></body></html>');
});

app.get('/api/homepage', async (req, res) => {
  try {
    const data = await giftedFetch('/homepage');
    res.json({ status: 'success', data });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch homepage content', error: error.message });
  }
});

app.get('/api/trending', async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const data = await giftedFetch('/trending');
    res.json({ status: 'success', data: normalizeListResponse(data, page) });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch trending content', error: error.message });
  }
});

app.get('/api/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const subjectType = parseInt(req.query.type, 10) || 0;
    const data = await giftedFetch(`/search/${encodeURIComponent(query)}?page=${page}`);
    let content = normalizeListResponse(data, page);
    if (subjectType !== 0) content.items = content.items.filter((item) => item.subjectType === subjectType);
    res.json({ status: 'success', data: content });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Failed to search content', error: error.message });
  }
});

app.get('/api/info/:movieId', async (req, res) => {
  try {
    const { movieId } = req.params;
    const data = await giftedFetch(`/info/${movieId}`);
    const results = extractResults(data);
    const subject = mapItem(results.subject || results);
    res.json({ status: 'success', data: { subject } });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch movie/series info', error: error.message });
  }
});

app.get('/api/sources/:movieId', async (req, res) => {
  try {
    const { movieId } = req.params;
    const season = parseInt(req.query.season, 10) || 0;
    const episode = parseInt(req.query.episode, 10) || 0;
    const data = await giftedFetch(`/sources/${movieId}?season=${season}&episode=${episode}`);
    const results = extractResults(data);
    const downloads = results.downloads || results.items || [];
    const protocol = req.get('x-forwarded-proto') || 'https';
    const baseUrl = `${protocol}://${req.get('host')}`;
    const title = results.title || results.subject?.title || 'video';
    const isEpisode = season > 0 && episode > 0;
    const processedSources = downloads.map((file) => {
      const quality = file.resolution || file.quality || 'Unknown';
      const fileUrl = file.url || file.link || '';
      const downloadParams = new URLSearchParams({ url: fileUrl, title, quality });
      if (isEpisode) {
        downloadParams.append('season', String(season));
        downloadParams.append('episode', String(episode));
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
    res.json({ status: 'success', data: { downloads, processedSources } });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch streaming sources', error: error.message });
  }
});

app.get('/api/stream', async (req, res) => {
  try {
    const streamUrl = req.query.url || '';
    if (!streamUrl || !streamUrl.match(/^https:\/\/[a-z0-9]+\.hakunaymatata\.com\//)) {
      return res.status(400).json({ status: 'error', message: 'Invalid stream URL' });
    }
    const range = req.headers.range;
    let fileSize;
    let contentType = 'video/mp4';
    try {
      const headResponse = await axios({ method: 'HEAD', url: streamUrl, headers: { 'User-Agent': 'okhttp/4.12.0', Referer: 'https://fmoviesunblocked.net/', Origin: 'https://fmoviesunblocked.net' } });
      fileSize = parseInt(headResponse.headers['content-length'], 10);
      contentType = headResponse.headers['content-type'] || contentType;
    } catch (headError) {
      const testResponse = await axios({ method: 'GET', url: streamUrl, responseType: 'stream', headers: { 'User-Agent': 'okhttp/4.12.0', Referer: 'https://fmoviesunblocked.net/', Origin: 'https://fmoviesunblocked.net', Range: 'bytes=0-0' } });
      testResponse.data.destroy();
      const contentRange = testResponse.headers['content-range'];
      if (contentRange) {
        const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
        if (match) fileSize = parseInt(match[1], 10);
      }
      contentType = testResponse.headers['content-type'] || contentType;
    }
    if (!fileSize || isNaN(fileSize)) throw new Error('Could not determine file size');
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      let start = parseInt(parts[0], 10);
      let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (isNaN(start) && !isNaN(end)) {
        start = fileSize - end;
        end = fileSize - 1;
      }
      if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
        return res.status(416).set({ 'Content-Range': `bytes */${fileSize}` }).json({ status: 'error', message: 'Range not satisfiable' });
      }
      const chunkSize = (end - start) + 1;
      const response = await axios({ method: 'GET', url: streamUrl, responseType: 'stream', headers: { 'User-Agent': 'okhttp/4.12.0', Referer: 'https://fmoviesunblocked.net/', Origin: 'https://fmoviesunblocked.net', Range: `bytes=${start}-${end}` } });
      res.status(206).set({ 'Content-Type': contentType, 'Content-Length': chunkSize, 'Content-Range': `bytes ${start}-${end}/${fileSize}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ...corsHeaders() });
      response.data.pipe(res);
    } else {
      const response = await axios({ method: 'GET', url: streamUrl, responseType: 'stream', headers: { 'User-Agent': 'okhttp/4.12.0', Referer: 'https://fmoviesunblocked.net/', Origin: 'https://fmoviesunblocked.net' } });
      res.status(200).set({ 'Content-Type': contentType, 'Content-Length': fileSize, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ...corsHeaders() });
      response.data.pipe(res);
    }
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ status: 'error', message: 'Failed to stream video', error: error.message });
  }
});

app.get('/api/download', async (req, res) => {
  try {
    const downloadUrl = req.query.url;
    const title = req.query.title || 'video';
    const season = req.query.season;
    const episode = req.query.episode;
    const quality = req.query.quality || '';
    if (!downloadUrl || !downloadUrl.match(/^https:\/\/[a-z0-9]+\.hakunaymatata\.com\//)) {
      return res.status(400).json({ status: 'error', message: 'Invalid download URL' });
    }
    let filename = sanitizeFilename(title);
    if (season && episode) filename += `_S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
    if (quality) filename += `_${quality}`;
    filename += '.mp4';
    const range = req.headers.range;
    let fileSize;
    let contentType = 'video/mp4';
    try {
      const headResponse = await axios({ method: 'HEAD', url: downloadUrl, headers: { 'User-Agent': 'okhttp/4.12.0', Referer: 'https://fmoviesunblocked.net/', Origin: 'https://fmoviesunblocked.net' } });
      fileSize = parseInt(headResponse.headers['content-length'], 10);
      contentType = headResponse.headers['content-type'] || contentType;
    } catch (headError) {
      const testResponse = await axios({ method: 'GET', url: downloadUrl, responseType: 'stream', headers: { 'User-Agent': 'okhttp/4.12.0', Referer: 'https://fmoviesunblocked.net/', Origin: 'https://fmoviesunblocked.net', Range: 'bytes=0-0' } });
      testResponse.data.destroy();
      const contentRange = testResponse.headers['content-range'];
      if (contentRange) {
        const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
        if (match) fileSize = parseInt(match[1], 10);
      }
      contentType = testResponse.headers['content-type'] || contentType;
    }
    if (!fileSize || isNaN(fileSize)) throw new Error('Could not determine file size');
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      let start = parseInt(parts[0], 10);
      let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (isNaN(start) && !isNaN(end)) {
        start = fileSize - end;
        end = fileSize - 1;
      }
      if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
        return res.status(416).set({ 'Content-Range': `bytes */${fileSize}` }).json({ status: 'error', message: 'Range not satisfiable' });
      }
      const chunkSize = (end - start) + 1;
      const response = await axios({ method: 'GET', url: downloadUrl, responseType: 'stream', timeout: 0, maxContentLength: Infinity, maxBodyLength: Infinity, headers: { 'User-Agent': 'okhttp/4.12.0', Referer: 'https://fmoviesunblocked.net/', Origin: 'https://fmoviesunblocked.net', Range: `bytes=${start}-${end}` } });
      res.status(206).set({ 'Content-Type': contentType, 'Content-Length': chunkSize, 'Content-Range': `bytes ${start}-${end}/${fileSize}`, 'Content-Disposition': `attachment; filename="${filename}"`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ...corsHeaders() });
      response.data.pipe(res);
    } else {
      const response = await axios({ method: 'GET', url: downloadUrl, responseType: 'stream', timeout: 0, maxContentLength: Infinity, maxBodyLength: Infinity, headers: { 'User-Agent': 'okhttp/4.12.0', Referer: 'https://fmoviesunblocked.net/', Origin: 'https://fmoviesunblocked.net' } });
      res.set({ 'Content-Type': contentType, 'Content-Length': fileSize, 'Content-Disposition': `attachment; filename="${filename}"`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ...corsHeaders() });
      response.data.pipe(res);
    }
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ status: 'error', message: 'Failed to proxy download', error: error.message });
  }
});

app.use((err, req, res, next) => {
  res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
});

app.use('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Endpoint not found',
    availableEndpoints: ['GET /api/homepage', 'GET /api/trending', 'GET /api/search/:query', 'GET /api/info/:movieId', 'GET /api/sources/:movieId']
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MovieBox API Server running on http://0.0.0.0:${PORT}`);
});

module.exports = app;
