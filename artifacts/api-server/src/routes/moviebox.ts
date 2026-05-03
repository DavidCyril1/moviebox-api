import { Router, type IRouter, type Request, type Response } from "express";
import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";

const router: IRouter = Router();

const SELECTED_HOST = process.env["MOVIEBOX_API_HOST"] || "h5.aoneroom.com";
const HOST_URL = `https://${SELECTED_HOST}`;

const DEFAULT_HEADERS = {
  "X-Client-Info": '{"timezone":"Africa/Nairobi"}',
  "Accept-Language": "en-US,en;q=0.5",
  Accept: "application/json",
  "User-Agent": "okhttp/4.12.0",
  Referer: HOST_URL,
  Host: SELECTED_HOST,
  Connection: "keep-alive",
  "X-Forwarded-For": "1.1.1.1",
  "CF-Connecting-IP": "1.1.1.1",
  "X-Real-IP": "1.1.1.1",
};

const jar = new CookieJar();
const axiosInstance = wrapper(
  axios.create({
    jar,
    withCredentials: true,
    timeout: 30000,
  })
);

let cookiesInitialized = false;

function processApiResponse(data: unknown): unknown {
  const d = data as Record<string, unknown> | null;
  if (d && d["data"]) return d["data"];
  return d || data;
}

async function ensureCookies(): Promise<void> {
  if (cookiesInitialized) return;
  await axiosInstance.get(
    `${HOST_URL}/wefeed-h5-bff/app/get-latest-app-pkgs?app_name=moviebox`,
    { headers: DEFAULT_HEADERS }
  );
  cookiesInitialized = true;
}

async function apiRequest(
  url: string,
  options: Record<string, unknown> = {}
): Promise<unknown> {
  await ensureCookies();
  const config = {
    url,
    headers: { ...DEFAULT_HEADERS, ...(options["headers"] as object || {}) },
    withCredentials: true,
    ...options,
  };
  const response = await axiosInstance(config as Parameters<typeof axiosInstance>[0]);
  return processApiResponse(response.data);
}

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .trim();
}

router.get("/homepage", async (_req: Request, res: Response) => {
  try {
    const data = await apiRequest(`${HOST_URL}/wefeed-h5-bff/web/home`);
    res.json({ status: "success", data });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ status: "error", message: msg });
  }
});

router.get("/trending", async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query["page"] as string) || 0;
    const perPage = parseInt(req.query["perPage"] as string) || 18;

    let items: unknown[] = [];

    try {
      const data = await apiRequest(`${HOST_URL}/wefeed-h5-bff/web/subject/trending`, {
        method: "GET",
        params: { page, perPage, uid: "5591179548772780352" },
      }) as Record<string, unknown>;
      items = (data?.["subjectList"] as unknown[]) || (data?.["items"] as unknown[]) || [];
    } catch {
      items = [];
    }

    if (items.length === 0) {
      const homeData = await apiRequest(`${HOST_URL}/wefeed-h5-bff/web/home`) as Record<string, unknown>;
      items = (homeData?.["subjectList"] as unknown[]) || [];
    }

    const mapped = (items as Record<string, unknown>[]).map((item) => {
      const cover = item["cover"] as Record<string, unknown> | undefined;
      const stills = item["stills"] as Record<string, unknown> | undefined;
      if (!item["thumbnail"]) {
        if (cover?.["url"]) item["thumbnail"] = cover["url"];
        else if (stills?.["url"]) item["thumbnail"] = stills["url"];
      }
      return item;
    });

    res.json({
      status: "success",
      data: {
        items: mapped,
        total: mapped.length,
        page,
        perPage,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ status: "error", message: msg });
  }
});

router.get("/search/:query", async (req: Request, res: Response) => {
  try {
    const { query } = req.params;
    const page = parseInt(req.query["page"] as string) || 1;
    const perPage = parseInt(req.query["perPage"] as string) || 24;
    const subjectType = parseInt(req.query["type"] as string) || 0;
    const data = await apiRequest(`${HOST_URL}/wefeed-h5-bff/web/subject/search`, {
      method: "POST",
      data: { keyword: query, page, perPage, subjectType },
    }) as Record<string, unknown>;

    let items = ((data?.["items"] as Record<string, unknown>[]) || []);
    if (subjectType !== 0) {
      items = items.filter((item) => item["subjectType"] === subjectType);
    }
    items = items.map((item) => {
      const cover = item["cover"] as Record<string, unknown> | undefined;
      const stills = item["stills"] as Record<string, unknown> | undefined;
      if (cover?.["url"] && !item["thumbnail"]) item["thumbnail"] = cover["url"];
      if (stills?.["url"] && !item["thumbnail"]) item["thumbnail"] = stills["url"];
      return item;
    });

    res.json({
      status: "success",
      data: {
        items,
        total: (data?.["total"] as number) || items.length,
        page,
        perPage,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ status: "error", message: msg });
  }
});

router.get("/info/:movieId", async (req: Request, res: Response) => {
  try {
    const { movieId } = req.params;
    const data = await apiRequest(`${HOST_URL}/wefeed-h5-bff/web/subject/detail`, {
      method: "GET",
      params: { subjectId: movieId },
    }) as Record<string, unknown>;
    const subject = (data?.["subject"] || data) as Record<string, unknown>;
    if (subject) {
      const cover = subject["cover"] as Record<string, unknown> | undefined;
      const stills = subject["stills"] as Record<string, unknown> | undefined;
      if (cover?.["url"] && !subject["thumbnail"]) subject["thumbnail"] = cover["url"];
      if (stills?.["url"] && !subject["thumbnail"]) subject["thumbnail"] = stills["url"];
    }
    res.json({ status: "success", data: { subject } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ status: "error", message: msg });
  }
});

router.get("/sources/:movieId", async (req: Request, res: Response) => {
  try {
    const { movieId } = req.params;
    const season = parseInt(req.query["season"] as string) || 0;
    const episode = parseInt(req.query["episode"] as string) || 0;

    const infoData = await apiRequest(`${HOST_URL}/wefeed-h5-bff/web/subject/detail`, {
      method: "GET",
      params: { subjectId: movieId },
    }) as Record<string, unknown>;

    const movieInfo = infoData as Record<string, unknown>;
    const subject = movieInfo?.["subject"] as Record<string, unknown> | undefined;
    const detailPath = subject?.["detailPath"] as string | undefined;
    const title = (subject?.["title"] as string) || "video";

    const refererUrl = detailPath
      ? `https://fmoviesunblocked.net/spa/videoPlayPage/movies/${detailPath}?id=${movieId}&type=/movie/detail`
      : HOST_URL;

    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["host"];
    const baseUrl = `${protocol}://${host}`;

    const data = await apiRequest(`${HOST_URL}/wefeed-h5-bff/web/subject/download`, {
      method: "GET",
      params: { subjectId: movieId, se: season, ep: episode },
      headers: {
        Referer: refererUrl,
        Origin: "https://fmoviesunblocked.net",
        "X-Forwarded-For": "1.1.1.1",
        "CF-Connecting-IP": "1.1.1.1",
        "X-Real-IP": "1.1.1.1",
      },
    }) as Record<string, unknown>;

    const downloads = ((data?.["downloads"] as Record<string, unknown>[]) || []);
    const isEpisode = season > 0 && episode > 0;

    const processedSources = downloads.map((file: Record<string, unknown>) => {
      const quality = (file["resolution"] || file["quality"] || "Unknown") as string;
      const fileUrl = (file["url"] || file["link"] || "") as string;
      const downloadParams = new URLSearchParams({ url: fileUrl, title, quality });
      if (isEpisode) {
        downloadParams.append("season", String(season));
        downloadParams.append("episode", String(episode));
      }
      return {
        id: file["id"] || null,
        quality,
        directUrl: fileUrl,
        downloadUrl: `${baseUrl}/api/download?${downloadParams.toString()}`,
        streamUrl: `${baseUrl}/api/stream?url=${encodeURIComponent(fileUrl)}`,
        size: file["size"] || null,
        format: "mp4",
      };
    });

    res.json({ status: "success", data: { downloads, processedSources } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ status: "error", message: msg });
  }
});

router.get("/stream", async (req: Request, res: Response) => {
  try {
    const streamUrl = req.query["url"] as string;
    if (!streamUrl) {
      return res.status(400).json({ status: "error", message: "Missing stream URL" });
    }
    const range = req.headers["range"];
    const headResponse = await axios.head(streamUrl, {
      headers: { "User-Agent": "okhttp/4.12.0" },
    });
    const fileSize = parseInt(headResponse.headers["content-length"] as string);
    const contentType = (headResponse.headers["content-type"] as string) || "video/mp4";
    if (!fileSize || isNaN(fileSize)) {
      return res.status(500).json({ status: "error", message: "Could not determine file size" });
    }
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      let start = parseInt(parts[0], 10);
      let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (isNaN(start) && !isNaN(end)) { start = fileSize - end; end = fileSize - 1; }
      if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
        return res.status(416).set({ "Content-Range": `bytes */${fileSize}` }).json({ status: "error", message: "Range not satisfiable" });
      }
      const chunkSize = end - start + 1;
      const response = await axios.get(streamUrl, {
        responseType: "stream",
        headers: { "User-Agent": "okhttp/4.12.0", Range: `bytes=${start}-${end}` },
      });
      res.status(206).set({
        "Content-Type": contentType,
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
      });
      (response.data as NodeJS.ReadableStream).pipe(res);
    } else {
      const response = await axios.get(streamUrl, {
        responseType: "stream",
        headers: { "User-Agent": "okhttp/4.12.0" },
      });
      res.status(200).set({
        "Content-Type": contentType,
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
      });
      (response.data as NodeJS.ReadableStream).pipe(res);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!res.headersSent) res.status(500).json({ status: "error", message: msg });
  }
});

router.get("/download", async (req: Request, res: Response) => {
  try {
    const downloadUrl = req.query["url"] as string;
    const title = (req.query["title"] as string) || "video";
    const season = req.query["season"] as string | undefined;
    const episode = req.query["episode"] as string | undefined;
    const quality = (req.query["quality"] as string) || "";

    if (!downloadUrl) {
      return res.status(400).json({ status: "error", message: "Missing download URL" });
    }

    let filename = sanitizeFilename(title);
    if (season && episode) filename += `_S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
    if (quality) filename += `_${quality}`;
    filename += ".mp4";

    const range = req.headers["range"];
    const headResponse = await axios.head(downloadUrl, {
      headers: { "User-Agent": "okhttp/4.12.0", Referer: "https://fmoviesunblocked.net/", Origin: "https://fmoviesunblocked.net" },
    });
    const fileSize = parseInt(headResponse.headers["content-length"] as string);
    const contentType = (headResponse.headers["content-type"] as string) || "video/mp4";
    if (!fileSize || isNaN(fileSize)) {
      return res.status(500).json({ status: "error", message: "Could not determine file size" });
    }
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      let start = parseInt(parts[0], 10);
      let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (isNaN(start) && !isNaN(end)) { start = fileSize - end; end = fileSize - 1; }
      if (isNaN(start) || isNaN(end) || start < 0 || end >= fileSize || start > end) {
        return res.status(416).set({ "Content-Range": `bytes */${fileSize}` }).json({ status: "error", message: "Range not satisfiable" });
      }
      const chunkSize = end - start + 1;
      const response = await axios.get(downloadUrl, {
        responseType: "stream",
        headers: { "User-Agent": "okhttp/4.12.0", Referer: "https://fmoviesunblocked.net/", Origin: "https://fmoviesunblocked.net", Range: `bytes=${start}-${end}` },
      });
      res.status(206).set({
        "Content-Type": contentType,
        "Content-Length": String(chunkSize),
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Accept-Ranges": "bytes",
      });
      (response.data as NodeJS.ReadableStream).pipe(res);
    } else {
      const response = await axios.get(downloadUrl, {
        responseType: "stream",
        headers: { "User-Agent": "okhttp/4.12.0", Referer: "https://fmoviesunblocked.net/", Origin: "https://fmoviesunblocked.net" },
      });
      res.set({
        "Content-Type": contentType,
        "Content-Length": String(fileSize),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Accept-Ranges": "bytes",
      });
      (response.data as NodeJS.ReadableStream).pipe(res);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!res.headersSent) res.status(500).json({ status: "error", message: msg });
  }
});

export default router;
