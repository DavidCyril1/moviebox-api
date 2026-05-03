import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  ArrowLeft, Star, Film, Download, Play, Loader2,
  Calendar, Clock, Tv, ChevronDown, ChevronUp, ExternalLink
} from "lucide-react";
import { useMovieInfo, useSources } from "@/hooks/useMovieBox";
import { cn } from "@/lib/utils";

export default function MoviePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useMovieInfo(id || "");
  const [selectedSeason, setSelectedSeason] = useState("1");
  const [selectedEpisode, setSelectedEpisode] = useState("1");
  const [showSources, setShowSources] = useState(false);
  const [showEpisodes, setShowEpisodes] = useState(false);

  const subject = data?.subject;
  const isSeries = subject?.subjectType === 2;
  const thumbnail = subject?.thumbnail || subject?.cover?.url || subject?.stills?.url;

  const { data: sourcesData, isLoading: sourcesLoading } = useSources(
    id || "",
    showSources && isSeries ? selectedSeason : showSources ? undefined : undefined,
    showSources && isSeries ? selectedEpisode : showSources ? undefined : undefined
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !subject) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <Film className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-40" />
        <h2 className="text-xl font-semibold mb-2">Movie not found</h2>
        <p className="text-muted-foreground mb-6">{error instanceof Error ? error.message : "Could not load details"}</p>
        <Link href="/">
          <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
            <ArrowLeft className="w-4 h-4" /> Back to Home
          </button>
        </Link>
      </div>
    );
  }

  const scoreNum = typeof subject.score === "number" ? subject.score : parseFloat(String(subject.score || 0));
  const genres = subject.genres || (subject["genre"] as string[]) || [];
  const cast = subject.cast || (subject["casts"] as typeof subject.cast) || [];
  const duration = subject.duration || (subject["mins"] as number);

  return (
    <div className="min-h-screen">
      {/* Back */}
      <div className="max-w-7xl mx-auto px-4 pt-6 pb-2">
        <Link href="/">
          <button className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        </Link>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row gap-8">
          {/* Poster */}
          <div className="flex-none">
            <div className="w-full md:w-56 aspect-[2/3] rounded-xl overflow-hidden bg-muted border border-border shadow-2xl">
              {thumbnail ? (
                <img src={thumbnail} alt={subject.title || ""} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Film className="w-16 h-16 text-muted-foreground opacity-30" />
                </div>
              )}
            </div>
          </div>

          {/* Details */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className={cn(
                "text-xs px-2.5 py-1 rounded-full font-medium",
                isSeries ? "bg-blue-500/15 text-blue-400" : "bg-primary/15 text-primary"
              )}>
                {isSeries ? (
                  <span className="flex items-center gap-1"><Tv className="w-3 h-3" /> Series</span>
                ) : (
                  <span className="flex items-center gap-1"><Film className="w-3 h-3" /> Movie</span>
                )}
              </span>
              {genres.slice(0, 3).map((g: string) => (
                <span key={g} className="text-xs px-2.5 py-1 rounded-full bg-accent text-accent-foreground">{g}</span>
              ))}
            </div>

            <h1 className="text-3xl md:text-4xl font-bold mb-3 leading-tight">{subject.title}</h1>

            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-4">
              {scoreNum > 0 && (
                <span className="flex items-center gap-1.5 text-yellow-400 font-semibold">
                  <Star className="w-4 h-4 fill-current" />
                  {scoreNum.toFixed(1)}
                </span>
              )}
              {subject.releaseDate && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  {new Date(subject.releaseDate as string).getFullYear() || subject.releaseDate}
                </span>
              )}
              {duration && (
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  {duration} min
                </span>
              )}
            </div>

            {subject.description && (
              <p className="text-muted-foreground leading-relaxed mb-6 max-w-2xl">
                {subject.description as string}
              </p>
            )}

            {cast && (Array.isArray(cast)) && cast.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Cast</h3>
                <div className="flex flex-wrap gap-2">
                  {cast.slice(0, 8).map((c, i) => (
                    <span key={i} className="text-sm px-3 py-1 rounded-full bg-accent text-accent-foreground">
                      {c.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Download button */}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setShowSources(!showSources)}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
              >
                <Download className="w-4 h-4" />
                {showSources ? "Hide" : "Get"} Download Links
              </button>
              {isSeries && (
                <button
                  onClick={() => setShowEpisodes(!showEpisodes)}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-secondary text-secondary-foreground font-medium hover:bg-secondary/80 transition-colors"
                >
                  <Tv className="w-4 h-4" />
                  Episodes
                  {showEpisodes ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Episodes selector */}
        {isSeries && showEpisodes && (
          <div className="mt-8 p-6 rounded-xl bg-card border border-border">
            <h3 className="font-semibold mb-4">Select Episode</h3>
            <div className="flex flex-wrap gap-3 mb-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Season</label>
                <select
                  value={selectedSeason}
                  onChange={(e) => setSelectedSeason(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-accent border border-border text-sm outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((s) => (
                    <option key={s} value={s}>{`Season ${s}`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Episode</label>
                <select
                  value={selectedEpisode}
                  onChange={(e) => setSelectedEpisode(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-accent border border-border text-sm outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {Array.from({ length: 30 }, (_, i) => i + 1).map((ep) => (
                    <option key={ep} value={ep}>{`Episode ${ep}`}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => setShowSources(true)}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
                >
                  Get Links
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Download links */}
        {showSources && (
          <div className="mt-8 p-6 rounded-xl bg-card border border-border">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Download className="w-5 h-5 text-primary" />
              Download Sources
              {isSeries && (
                <span className="text-sm text-muted-foreground font-normal">
                  — S{selectedSeason}E{selectedEpisode}
                </span>
              )}
            </h3>

            {sourcesLoading && (
              <div className="flex items-center gap-3 py-4">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span className="text-muted-foreground text-sm">Loading sources...</span>
              </div>
            )}

            {sourcesData && sourcesData.processedSources.length === 0 && !sourcesLoading && (
              <p className="text-muted-foreground text-sm py-4">No download sources available for this title.</p>
            )}

            {sourcesData && sourcesData.processedSources.length > 0 && (
              <div className="flex flex-col gap-3">
                {sourcesData.processedSources.map((source, i) => (
                  <div
                    key={i}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-accent border border-border"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center flex-none">
                        <Film className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm">{source.quality || "Unknown"}</div>
                        <div className="text-xs text-muted-foreground">
                          {source.format?.toUpperCase() || "MP4"}
                          {source.size && ` • ${source.size}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {source.streamUrl && (
                        <a
                          href={source.streamUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" /> Stream
                        </a>
                      )}
                      {source.downloadUrl && (
                        <a
                          href={source.downloadUrl}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" /> Download
                        </a>
                      )}
                      {source.directUrl && (
                        <a
                          href={source.directUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-accent-foreground text-xs font-medium hover:bg-accent/80 border border-border transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Direct
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
