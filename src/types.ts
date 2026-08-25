// ── API envelope ─────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

// ── Shared primitives ─────────────────────────────────────────────────────────

export interface Cover {
  url: string;
  width: number;
  height: number;
  format: string;
  thumbnail?: string;
  averageHueLight?: string;
  averageHueDark?: string;
}

export interface PlayUrl {
  playUrl: string;
  urlType: string;
}

// ── Subject (movie / TV show) ─────────────────────────────────────────────────

export interface Subject {
  subjectId: string;
  subjectType: number; // 1 = movie, 2 = TV
  title: string;
  description: string;
  releaseDate: string;
  genre: string;
  cover: Cover | null;
  stills: Cover | null;
  countryName: string;
  language: string;
  imdbRatingValue: string;
  hasResource: boolean;
  detailUrl: string;
  playUrl: PlayUrl | null;
  seNum?: number;
  season?: number;
  contentRating?: string;
  duration?: string;
  durationSeconds?: number;
  isCam?: boolean;
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface SearchResultGroup {
  topicType: string;
  subjects: Subject[];
}

export interface SearchData {
  pager: {
    hasMore: boolean;
    nextPage: string;
    page: string;
    perPage: number;
    totalCount: number;
  };
  results: SearchResultGroup[];
}

// ── Season info ──────────────────────────────────────────────────────────────

export interface SeasonItem {
  season: number;
  subjectId: string;
  title: string;
  releaseDate: string;
  cover: Cover | null;
  episodeCount?: number;
}

export interface SeasonInfoData {
  seasons: SeasonItem[];
  currentSeason?: number;
}

// ── Resource (episode list / stream sources) ──────────────────────────────────

export interface ResourceItem {
  resourceId: string;
  episode: number;
  title?: string;
  duration?: number;
  hasSource: boolean;
  streamUrl?: string;
  subtitles?: SubtitleItem[];
}

export interface ResourceData {
  pager: {
    hasMore: boolean;
    nextPage: string;
    page: string;
    perPage: number;
  };
  resources: ResourceItem[];
}

// ── Play info (stream sources) ────────────────────────────────────────────────

export interface StreamSource {
  url: string;
  quality?: string;
  format?: string;
  size?: number;
  headers?: Record<string, string>;
}

export interface PlayInfoData {
  streams: StreamSource[];
  subtitles?: SubtitleItem[];
  drm?: unknown;
}

// ── Subtitles ─────────────────────────────────────────────────────────────────

export interface SubtitleItem {
  language: string;
  url: string;
  format?: string;
}

// ── Trending ──────────────────────────────────────────────────────────────────

export interface TrendingItem {
  rank?: number;
  subject: Subject;
  hotScore?: number;
}

export interface TrendingData {
  items: TrendingItem[];
}

// ── Staff ─────────────────────────────────────────────────────────────────────

export interface StaffInfo {
  staffId: string;
  name: string;
  photo?: Cover;
  bio?: string;
  birthDate?: string;
  nationality?: string;
  knownFor?: string[];
}

// ── Recommendations ───────────────────────────────────────────────────────────

export interface RecommendData {
  subjects: Subject[];
}

// ── Home tab / categories ─────────────────────────────────────────────────────

export interface TabItem {
  tabId: string;
  title: string;
  type?: string;
}

export interface BottomTabData {
  tabs: TabItem[];
}
