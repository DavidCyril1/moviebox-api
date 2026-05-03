import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Search, Film, TrendingUp, Home, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Navbar() {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const links = [
    { href: "/", label: "Home", icon: Home },
    { href: "/trending", label: "Trending", icon: TrendingUp },
    { href: "/search", label: "Search", icon: Search },
  ];

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Film className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg tracking-tight">MovieBox</span>
          </div>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {links.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}>
              <div className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer",
                location === href
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}>
                <Icon className="w-4 h-4" />
                {label}
              </div>
            </Link>
          ))}
        </div>

        <button
          className="md:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {menuOpen && (
        <div className="md:hidden border-t border-border bg-background px-4 py-3 flex flex-col gap-1">
          {links.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}>
              <div
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium cursor-pointer",
                  location === href
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
                onClick={() => setMenuOpen(false)}
              >
                <Icon className="w-4 h-4" />
                {label}
              </div>
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
