import { Link } from "wouter";
import { Star, Film } from "lucide-react";
import { type MovieItem } from "@/hooks/useMovieBox";
import { cn } from "@/lib/utils";

interface MovieCardProps {
  movie: MovieItem;
  className?: string;
}

export function MovieCard({ movie, className }: MovieCardProps) {
  const id = movie.subjectId || movie.id || "";
  const thumbnail = movie.thumbnail || movie.cover?.url || movie.stills?.url;
  const typeLabel = movie.subjectType === 2 ? "Series" : movie.subjectType === 6 ? "Music" : "Movie";

  return (
    <Link href={`/movie/${id}`}>
      <div className={cn("movie-card group cursor-pointer rounded-lg overflow-hidden bg-card border border-border", className)}>
        <div className="poster-wrap aspect-[2/3] bg-muted relative">
          {thumbnail ? (
            <img
              src={thumbnail}
              alt={movie.title || "Movie"}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Film className="w-12 h-12 text-muted-foreground opacity-40" />
            </div>
          )}
          <div className="absolute bottom-0 left-0 right-0 p-3 z-10">
            <span className="inline-block text-xs px-2 py-0.5 rounded bg-primary/80 text-primary-foreground font-medium">
              {typeLabel}
            </span>
          </div>
        </div>
        <div className="p-3">
          <h3 className="font-medium text-sm text-foreground line-clamp-2 leading-tight mb-1">
            {movie.title || "Unknown"}
          </h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {movie.score !== undefined && (
              <span className="flex items-center gap-1 text-yellow-400">
                <Star className="w-3 h-3 fill-current" />
                {typeof movie.score === "number" ? movie.score.toFixed(1) : movie.score}
              </span>
            )}
            {movie.releaseDate && (
              <span>{new Date(movie.releaseDate as string).getFullYear() || movie.releaseDate}</span>
            )}
            {movie.year && !movie.releaseDate && <span>{movie.year as number}</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}
