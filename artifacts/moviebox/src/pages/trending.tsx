import { TrendingUp, Loader2, Film } from "lucide-react";
import { useTrending } from "@/hooks/useMovieBox";
import { MovieCard } from "@/components/MovieCard";

export default function Trending() {
  const { data, isLoading, error } = useTrending();

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
          <TrendingUp className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Trending</h1>
          <p className="text-sm text-muted-foreground">Most popular movies and TV series right now</p>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <Film className="w-8 h-8 text-destructive" />
          </div>
          <h3 className="font-semibold mb-1">Failed to load trending</h3>
          <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "API error"}</p>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {data.map((movie) => (
            <MovieCard key={movie.subjectId || movie.id} movie={movie} />
          ))}
        </div>
      )}
    </div>
  );
}
