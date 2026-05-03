import { useState } from "react";
import { useLocation } from "wouter";
import { Search, TrendingUp, Film, Loader2 } from "lucide-react";
import { useTrending } from "@/hooks/useMovieBox";
import { MovieCard } from "@/components/MovieCard";

export default function Home() {
  const [query, setQuery] = useState("");
  const [, navigate] = useLocation();
  const { data: trending, isLoading, error } = useTrending();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <div className="relative py-20 px-4 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/10 via-background to-background" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,_hsl(340_85%_55%_/_0.15),_transparent_70%)]" />
        <div className="relative max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-6">
            <Film className="w-4 h-4" />
            MovieBox API
          </div>
          <h1 className="text-5xl font-bold mb-4 tracking-tight">
            Explore Movies &<br />
            <span className="text-primary">TV Series</span>
          </h1>
          <p className="text-muted-foreground text-lg mb-8 max-w-xl mx-auto">
            Search, discover, and stream movies and TV shows with real download links in multiple qualities.
          </p>
          <form onSubmit={handleSearch} className="flex gap-3 max-w-lg mx-auto">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for a movie or TV series..."
                className="w-full pl-11 pr-4 py-3.5 rounded-xl bg-card border border-border text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary text-sm"
              />
            </div>
            <button
              type="submit"
              className="px-6 py-3.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
            >
              Search
            </button>
          </form>
        </div>
      </div>

      {/* Trending */}
      <div className="max-w-7xl mx-auto px-4 pb-16">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Trending Now</h2>
            <p className="text-sm text-muted-foreground">Live trending movies and TV series</p>
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
            <h3 className="font-semibold mb-1">Failed to load trending content</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              {error instanceof Error ? error.message : "Unable to connect to the MovieBox API. Please try again."}
            </p>
          </div>
        )}

        {trending && trending.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Film className="w-12 h-12 text-muted-foreground opacity-40 mb-4" />
            <p className="text-muted-foreground">No trending content found</p>
          </div>
        )}

        {trending && trending.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {trending.map((movie) => (
              <MovieCard key={movie.subjectId || movie.id} movie={movie} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
