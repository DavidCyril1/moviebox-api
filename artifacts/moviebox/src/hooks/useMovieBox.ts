import { useQuery } from "@tanstack/react-query";

const BASE = "/api";

export interface MovieItem {
  subjectId?: string;
  id?: string;
  title?: string;
  subjectType?: number;
  thumbnail?: string;
  cover?: { url?: string };
  stills?: { url?: string };
  releaseDate?: string;
  score?: number;
  year?: number;
  description?: string;
  [key: string]: unknown;
}

export interface MovieDetail {
  subject?: MovieItem & {
    episodes?: { season: number; episode: number; title?: string }[];
    cast?: { name: string; role?: string }[];
    genres?: string[];
    duration?: number;
  };
}

export interface Source {
  id?: string;
  quality?: string;
  directUrl?: string;
  downloadUrl?: string;
  streamUrl?: string;
  size?: string;
  format?: string;
}

function getThumbnail(item: MovieItem): string | undefined {
  return item.thumbnail || item.cover?.url || item.stills?.url;
}

async function apiFetch(path: string) {
  const res = await fetch(`${BASE}${path}`);
  const json = await res.json();
  if (json.status === "error") throw new Error(json.message || "API error");
  return json.data;
}

export function useTrending() {
  return useQuery({
    queryKey: ["trending"],
    queryFn: () => apiFetch("/trending"),
    select: (data) => {
      const items: MovieItem[] = data?.items || data?.list || [];
      return items.map((item) => ({ ...item, thumbnail: getThumbnail(item) }));
    },
  });
}

export function useSearch(query: string) {
  return useQuery({
    queryKey: ["search", query],
    queryFn: () => apiFetch(`/search/${encodeURIComponent(query)}`),
    enabled: query.length > 1,
    select: (data) => {
      const items: MovieItem[] = data?.items || data?.list || [];
      return items.map((item) => ({ ...item, thumbnail: getThumbnail(item) }));
    },
  });
}

export function useMovieInfo(movieId: string) {
  return useQuery({
    queryKey: ["info", movieId],
    queryFn: () => apiFetch(`/info/${movieId}`),
    enabled: !!movieId,
    select: (data: MovieDetail) => data,
  });
}

export function useSources(movieId: string, season?: string, episode?: string) {
  const params = season && episode ? `?season=${season}&episode=${episode}` : "";
  return useQuery({
    queryKey: ["sources", movieId, season, episode],
    queryFn: () => apiFetch(`/sources/${movieId}${params}`),
    enabled: !!movieId,
    select: (data) => ({
      downloads: (data?.downloads || []) as Source[],
      processedSources: (data?.processedSources || []) as Source[],
    }),
  });
}
