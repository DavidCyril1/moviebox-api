# MovieBox API — deploy

## Setup
1. Upload this folder to the server
2. Entry point: `index.js`
3. Port: **`PORT` env or 3000**
4. `npm install` then `node index.js`

## Env (optional)
- `MB_TOKEN` — guest JWT (auto-registers if missing)
- `MB_PROXY` — proxy URL for registration

## Stream / download (fixed)

CDN often blocks clients. **`/stream` and `/dl` no longer 302 to the CDN.**
They proxy the real MP4 through this server. **Same URLs as before** — clients do not need new paths.

| Endpoint | Response |
|----------|----------|
| `GET /stream/:id/:se/:ep?resolution=480` | `200` `video/mp4` (inline), Range supported |
| `GET /dl/:id/:se/:ep?resolution=480` | `200` `video/mp4` (attachment), Range supported |
| `GET /pipe/...` | Same proxy (compat alias) |

Debug: `GET /stream/...?redirect=0` → JSON `{ url }` (CDN URL, for debugging only).

Movies: `se=0&ep=0`. Series: real season/episode.

## Notes
- Real links from resource-position/v2 (not poisoned play-info).
- Many files are HEVC (H.265).
