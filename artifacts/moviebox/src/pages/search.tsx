import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Search as SearchIcon, Loader2, Film } from "lucide-react";
import { useSearch } from "@/hooks/useMovieBox";
import { MovieCard } from "@/components/MovieCard";

export default function SearchPage() {
  const [location] = useLocation();
  const params = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  );
  const initialQuery = params.get("q") || "";
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery);
  const [, navigate] = useLocation();

  const { data, isLoading, error } = useSearch(submitted);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const q = p.get("q") || "";
    setQuery(q);
    setSubmitted(q);
  }, [location]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) {
      setSubmitted(q);
      navigate(`/search?q=${encodeURIComponent(q)}`);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
          <SearchIcon className="w-6 h-6 text-primary" />
        </div>
        <h1 className="text-2xl font-bold">Search</h1>
      </div>

      <form onSubmit={handleSearch} className="flex gap-3 mb-8 max-w-2xl">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search movies, series, music..."
            className="w-full pl-11 pr-4 py-3 rounded-xl bg-card border border-border text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary text-sm"
            autoFocus
          />
        </div>
        <button
          type="submit"
          className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
        >
          Search
        </button>
      </form>

      {submitted && (
        <div className="mb-4 text-sm text-muted-foreground">
          {isLoading ? "Searching..." : data ? `${data.length} results for "${submitted}"` : ""}
        </div>
      )}

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
          <h3 className="font-semibold mb-1">Search failed</h3>
          <p className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "API error"}</p>
        </div>
      )}

      {!submitted && !isLoading && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <SearchIcon className="w-12 h-12 text-muted-foreground opacity-30 mb-4" />
          <p className="text-muted-foreground">Enter a movie or TV show name to search</p>
          <p className="text-xs text-muted-foreground mt-2">Try "Avatar", "Spider-Man", or "Wednesday"</p>
        </div>
      )}

      {data && data.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Film className="w-12 h-12 text-muted-foreground opacity-30 mb-4" />
          <p className="text-muted-foreground">No results found for "{submitted}"</p>
          <p className="text-xs text-muted-foreground mt-2">Try a different search term</p>
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
