# MovieBox Scraper API

Unofficial REST API that scrapes the undocumented MovieBox backend (`api6.aoneroom.com`). All requests are signed with a reverse-engineered HMAC-MD5 signature.

**Live base URL:** `https://moviebox-api-eight.vercel.app`

---

## Endpoints at a glance

| Endpoint | Description |
|---|---|
| `GET /search?q=...` | Search movies & TV shows |
| `GET /info/:subjectId` | Title metadata (cast, synopsis, rating) |
| `GET /seasons/:subjectId` | Season list for a TV show |
| `GET /episodes/:subjectId/:se` | Episode list for a season |
| `GET /sources/:subjectId/:se/:ep` | Raw stream URLs + CloudFront cookies |
| `GET /stream/:subjectId/:se/:ep` | **HLS proxy — play directly in mpv/VLC** |
| `GET /dl/:subjectId/:se/:ep` | **MP4 download — 302 redirect to signed file** |
| `GET /trending` | Trending searches & charts |
| `GET /trending/community` | Community trending posts |
| `GET /recommend/daily` | Daily recommendations |
| `GET /recommend/related/:subjectId` | Related titles |
| `GET /captions/stream/:subjectId/:streamId` | Embedded subtitle tracks |
| `GET /captions/ext/:subjectId/:resourceId/:episode` | External subtitle files |
| `GET /dub/:subjectId` | Available dub languages |
| `GET /staff/:staffId` | Actor/director profile |
| `GET /staff/:staffId/subjects` | Staff filmography |
| `GET /download/:subjectId/:se` | Signed MP4 download URLs (raw) |
| `GET /download/:subjectId/:se/check` | VIP entitlement check |

---

## Quick start (self-hosted)

```bash
git clone https://github.com/samuel-asleep/moviebox-api
cd moviebox-api
npm install
npm run dev        # tsx hot-reload  →  http://localhost:3000
# or
npm run build && npm start
```

Set `PORT` env var to change the port (default `3000`).

---

## Authentication

A Bearer JWT from a real MovieBox account session is required. Set it via:

```bash
export MB_TOKEN="eyJhbGci..."
```

A fallback token is bundled and valid until **2026-11-13**. After expiry, obtain a fresh one by logging into the MovieBox Android app and intercepting traffic.

---

## Endpoint reference

All successful responses follow:
```json
{ "success": true, "data": { ... } }
```
Errors return:
```json
{ "success": false, "error": "description" }
```

---

### `GET /search`

Search movies and TV shows.

| Param | Default | Description |
|---|---|---|
| `q` | **required** | Search keyword |
| `page` | `1` | Page number |
| `perPage` | `20` | Results per page |

```bash
curl "https://moviebox-api-eight.vercel.app/search?q=mentalist"
curl "https://moviebox-api-eight.vercel.app/search?q=breaking+bad&page=1&perPage=10"
```

---

### `GET /info/:subjectId`

Full metadata for a movie or TV show — synopsis, cast, rating, poster, seasons.

| Param | Default | Description |
|---|---|---|
| `se` | *(optional)* | Season number (TV shows) |

```bash
# The Mentalist
curl "https://moviebox-api-eight.vercel.app/info/7845473610491125400"

# Season 2 info
curl "https://moviebox-api-eight.vercel.app/info/7845473610491125400?se=2"
```

---

### `GET /seasons/:subjectId`

List all seasons for a TV show.

```bash
curl "https://moviebox-api-eight.vercel.app/seasons/7845473610491125400"
```

---

### `GET /episodes/:subjectId/:se`

Episode list for a specific season.

| Param | Default | Description |
|---|---|---|
| `page` | `1` | Page number |
| `perPage` | `20` | Max 20 per page |

```bash
# The Mentalist Season 1 episodes
curl "https://moviebox-api-eight.vercel.app/episodes/7845473610491125400/1"
curl "https://moviebox-api-eight.vercel.app/episodes/7845473610491125400/1?page=2&perPage=20"
```

---

### `GET /sources/:subjectId/:se/:ep`

Raw stream data for one episode — HLS URLs and CloudFront signed cookies. Use `/stream` instead if you just want to play the video.

For movies use `se=1` and `ep=1`.

```bash
# The Mentalist S1E1
curl "https://moviebox-api-eight.vercel.app/sources/7845473610491125400/1/1"
```

Response includes `streams[]` each with:
- `url` — HLS `.m3u8` URL
- `resolutions` — `"480"` | `"720"` | `"1080"`
- `signCookie` — CloudFront cookie string (required to actually fetch the stream)

---

### `GET /stream/:subjectId/:se/:ep`

**HLS proxy.** Fetches the stream from CloudFront with signed cookies and pipes it through the server. No auth or cookies needed on the client side — just open the URL in any player.

| Param | Default | Description |
|---|---|---|
| `resolution` | `480` | `480` \| `720` \| `1080` |

Segment URLs inside the `.m3u8` playlist are rewritten to route through this server, so the player never needs to touch CloudFront directly.

```bash
# Play in mpv
mpv "https://moviebox-api-eight.vercel.app/stream/7845473610491125400/1/1"
mpv "https://moviebox-api-eight.vercel.app/stream/7845473610491125400/1/1?resolution=1080"

# Play in VLC
vlc "https://moviebox-api-eight.vercel.app/stream/7845473610491125400/1/1?resolution=720"
```

---

### `GET /dl/:subjectId/:se/:ep`

**MP4 download redirect.** Returns a `302` to a direct signed MP4 file. Follow with `-L` in curl/wget or open in a browser.

| Param | Default | Description |
|---|---|---|
| `resolution` | `480` | `360` \| `480` \| `720` \| `1080` |

```bash
# Download with curl
curl -L "https://moviebox-api-eight.vercel.app/dl/7845473610491125400/1/1?resolution=720" -o s1e1.mp4

# Download with wget
wget "https://moviebox-api-eight.vercel.app/dl/7845473610491125400/1/1" -O s1e1.mp4
```

---

### `GET /trending`

Trending movies and TV shows.

| Param | Default | Description |
|---|---|---|
| `type` | `2` | Trending category type |

```bash
curl "https://moviebox-api-eight.vercel.app/trending"
```

---

### `GET /trending/community`

Community trending posts.

| Param | Default | Description |
|---|---|---|
| `postNum` | `3` | Number of posts per item |

```bash
curl "https://moviebox-api-eight.vercel.app/trending/community"
```

---

### `GET /recommend/daily`

Daily personalised recommendations.

| Param | Default | Description |
|---|---|---|
| `page` | `1` | Page number |
| `perPage` | `20` | Results per page |

```bash
curl "https://moviebox-api-eight.vercel.app/recommend/daily"
```

---

### `GET /recommend/related/:subjectId`

Related titles for a given movie or show.

| Param | Default | Description |
|---|---|---|
| `page` | `1` | Page number |
| `perPage` | `12` | Results per page |

```bash
curl "https://moviebox-api-eight.vercel.app/recommend/related/7845473610491125400"
```

---

### `GET /captions/stream/:subjectId/:streamId`

Embedded subtitle tracks for a stream. `streamId` comes from the `id` field in `/sources` response.

```bash
curl "https://moviebox-api-eight.vercel.app/captions/stream/5277074313408040752/5206205848711823672"
```

---

### `GET /captions/ext/:subjectId/:resourceId/:episode`

External subtitle files for an episode. `resourceId` comes from the `id` field in `/sources` streams array.

```bash
# The Mentalist S1E1 external captions
curl "https://moviebox-api-eight.vercel.app/captions/ext/7845473610491125400/1799830578779276736/1"
```

---

### `GET /dub/:subjectId`

Available dubbing language options for a title.

```bash
curl "https://moviebox-api-eight.vercel.app/dub/7845473610491125400"
```

---

### `GET /staff/:staffId`

Actor or director profile. Get `staffId` from the `staffList` array in `/info` response.

```bash
# Simon Baker (The Mentalist)
curl "https://moviebox-api-eight.vercel.app/staff/5707171931481407552"
```

---

### `GET /staff/:staffId/subjects`

Filmography / subject list for a staff member.

| Param | Default | Description |
|---|---|---|
| `start` | `1` | Start index |
| `end` | `20` | End index |

```bash
curl "https://moviebox-api-eight.vercel.app/staff/5707171931481407552/subjects?start=1&end=20"
```

---

### `GET /download/:subjectId/:se`

Raw signed MP4 download URLs for a range of episodes. Use `/dl` for a simpler redirect-based approach.

| Param | Default | Description |
|---|---|---|
| `resolution` | `480` | `360` \| `480` \| `720` \| `1080` |
| `epFrom` | `1` | First episode |
| `epTo` | `1` | Last episode |
| `page` | `1` | Page |
| `perPage` | `20` | Per page |

```bash
curl "https://moviebox-api-eight.vercel.app/download/7845473610491125400/1?resolution=720&epFrom=1&epTo=3"
```

---

### `GET /download/:subjectId/:se/check`

Check whether the account has VIP download entitlement for specific episodes.

| Param | Default | Description |
|---|---|---|
| `resolution` | `480` | Resolution tier |
| `eps` | `1` | Comma-separated episode numbers |

```bash
curl "https://moviebox-api-eight.vercel.app/download/7845473610491125400/1/check?resolution=720&eps=1,2,3"
```

---

## Subject IDs for testing

| Title | subjectId |
|---|---|
| The Mentalist | `7845473610491125400` |

Get more IDs via `/search`.

---

## Deploy

### Vercel (current)
Connected to `samuel-asleep/moviebox-api`. Auto-deploys on push to `main`.

### Self-hosted
```bash
npm run build
npm start   # PORT=3000
```

---

## Tech stack

- **Runtime:** Node.js + [Hono](https://hono.dev)
- **HTTP client:** `undici` (bypasses proxy layers)
- **Signing:** HMAC-MD5 with reverse-engineered key from APK
- **Deploy:** Vercel serverless (`@vercel/node`)
