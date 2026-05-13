"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

const NAV_LINKS = [
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/#features", label: "Features" },
  { href: "/dashboard", label: "Dashboard" },
];

interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();

  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => setUser(null));
  }, [pathname]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.push("/");
    router.refresh();
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="mx-auto grid h-[72px] max-w-[1440px] grid-cols-3 items-center px-6">
        <div className="justify-self-start">
          <Logo />
        </div>

        <div className="hidden items-center justify-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center justify-self-end gap-3">
          {user === undefined ? null : user ? (
            <>
              <span className="hidden text-sm text-muted-foreground md:block">
                {user.name || user.email}
              </span>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                Sign out
              </Button>
            </>
          ) : (
            <Link
              href="/login"
              className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
          )}

          <Link
            href="/report"
            className={`btn-cta btn-cta-dark ${pathname === "/report" ? "opacity-70" : ""}`}
          >
            Report Issue
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </div>
    </nav>
  );
}
