# MovieBox Workspace

## Overview

pnpm workspace monorepo using TypeScript. A MovieBox movie/TV streaming app with an Express API backend and React frontend.

## Artifacts

- **`artifacts/moviebox`** — React + Vite + Tailwind frontend (port 22783, preview at `/`)
- **`artifacts/api-server`** — Express 5 API server (port 8080, preview at `/api`)

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Frontend**: React + Vite + TanStack Query + Wouter routing + Tailwind CSS
- **Build**: esbuild (ESM bundle for api-server)

## MovieBox API Routes (api-server)

All routes under `/api/`:

| Route | Description |
|---|---|
| `GET /api/healthz` | Health check |
| `GET /api/homepage` | Home page curated content |
| `GET /api/trending` | Trending movies/TV (falls back to homepage subjectList) |
| `GET /api/search/:query` | Search movies/TV series (POST to upstream) |
| `GET /api/info/:movieId` | Movie/series detail info |
| `GET /api/sources/:movieId` | Download/stream sources |
| `GET /api/stream` | Proxy video stream with range support |
| `GET /api/download` | Proxy file download with proper filename |

## Upstream API

- Host: `h5.aoneroom.com` (configurable via `MOVIEBOX_API_HOST` env var)
- Cookie jar: initialized via `/wefeed-h5-bff/app/get-latest-app-pkgs?app_name=moviebox`
- Content base path: `/wefeed-h5-bff/web/`
- Trending response key: `subjectList` (not `items`)
- Search is a POST with JSON body `{keyword, page, perPage, subjectType}`

## Frontend Pages

- `/` — Home with hero search + trending grid
- `/trending` — Full trending page
- `/search?q=...` — Search results
- `/movie/:id` — Movie detail + sources/download

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/moviebox run dev` — run frontend locally

## Important Notes

- The api-server uses `@workspace/db` (postgres/drizzle) in shared deps but MovieBox routes don't use any DB
- Cookie jar is shared across all requests (singleton `CookieJar` instance)
- Trending endpoint tries `/web/subject/trending` first, falls back to `/web/home` subjectList
- Stream/download routes support HTTP range requests for seek support
