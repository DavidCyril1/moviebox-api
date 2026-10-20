# MovieBox API (KataBump / Cineverse)

CDN-safe MovieBox scraper + stream proxy.

## Live

https://stream.cinverse.com.ng

## Endpoints

| Path | Description |
|------|-------------|
| `GET /search?q=` | Search |
| `GET /info/:subjectId` | Subject details |
| `GET /sources/:subjectId/:se/:ep` | Play-info streams |
| `GET /stream/:subjectId/:se/:ep?resolution=480` | Proxied MP4 |
| `GET /stream-web/:subjectId/:se/:ep?resolution=480` | Resolve + proxy (H5 optional `?h5=1`) |
| `GET /api/stream?url=` | Thin CDN proxy (worker-style) |
| `GET /api/download?url=&title=` | Download proxy |
| `GET /health` | Health check |

`?redirect=0` on stream routes returns JSON only.

## Env

| Variable | Description |
|----------|-------------|
| `PORT` | Listen port (default 3000) |
| `MB_TOKEN` | MovieBox JWT (full-access) |
| `MB_CLIENT_INFO` | Matching x-client-info JSON for the token |
| `MB_FALLBACK_TOKEN` | Backup JWT |
| `CF_TUNNEL_TOKEN` | Cloudflare tunnel token |
| `MB_PROXY` | Optional single HTTP proxy for registration |

## Start

```bash
npm install
npm start
```

Token is loaded from `MB_TOKEN` or `.mb_token.json`. Guest registration can refresh a restricted token when temp-mail works.
