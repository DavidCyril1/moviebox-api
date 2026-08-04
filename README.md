# MovieBox API

Complete API for MovieBox content: search movies/TV series, get trending content, access streaming sources.

---

## Endpoints

### `GET /api/homepage`
Featured homepage content and recommendations.

**Response:**
```json
{ "status": "success", "data": { ...content } }
```

---

### `GET /api/trending`
Currently trending movies and TV series.

**Parameters:** `page` (0), `perPage` (18)

**Response:**
```json
{ "status": "success", "data": { "items": [...] } }
```

---

### `GET /api/categories`
List all content categories.

**Response:**
```json
{ "status": "success", "data": { "categories": [...] } }
```

---

### `GET /api/category/:categoryPath`
Browse content by category.

**Example:** `/api/category/0UA0warzA4`

**Response:**
```json
{ "status": "success", "data": { "items": [...] } }
```

---

### `GET /api/search/:query`
Search movies and TV series.

**Parameters:** `page` (1), `perPage` (24), `type` (0=All, 1=Movies, 2=TV, 6=Music)

**Example:** `/api/search/avatar?type=1`

**Response:**
```json
{
  "status": "success",
  "data": {
    "items": [
      {
        "id": "8906247916759695608",
        "title": "Avatar",
        "subjectType": 1,
        "thumbnail": "https://...",
        "cover": { "url": "..." }
      }
    ]
  }
}
```

---

### `GET /api/info/:movieId`
Detailed movie/series information.

**Example:** `/api/info/8906247916759695608`

**Response:**
```json
{
  "status": "success",
  "data": {
    "subject": {
      "id": "...",
      "title": "Avatar",
      "description": "...",
      "subjectType": 1,
      "thumbnail": "...",
      "detailPath": "...",
      "cover": {},
      "stills": {}
    }
  }
}
```

---

### `GET /api/sources/:movieId`
Streaming sources and download links in multiple qualities.

**Parameters:** `season` (0), `episode` (0)

**Examples:**
- `/api/sources/8906247916759695608` (movie)
- `/api/sources/9028867555875774472?season=1&episode=1` (TV episode)

**Response:**
```json
{
  "status": "success",
  "data": {
    "downloads": [
      { "id": "...", "url": "https://...", "resolution": "1080p", "size": "2.5GB" }
    ],
    "processedSources": [
      {
        "id": "...",
        "quality": "1080p",
        "directUrl": "https://...",
        "downloadUrl": "/api/download?url=...",
        "streamUrl": "/api/stream?url=...",
        "size": "2.5GB",
        "format": "mp4"
      }
    ]
  }
}
```

---

### `GET /api/stream`
Stream video with seeking support (HTTP range requests).

**Parameters:** `url` (required)

**Response:** Video stream (video/mp4), status 200 or 206

---

### `GET /api/download`
Download video with resumable support.

**Parameters:** `url` (required), `title`, `season`, `episode`, `quality`

**Response:** Video file (video/mp4) with Content-Disposition header

---

## Error Response

```json
{
  "status": "error",
  "message": "Error description",
  "error": "Detailed error message"
}
```
 
