"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, LayoutDashboard, LogOut } from "lucide-react";
import { Menu } from "@base-ui/react/menu";
import { Logo } from "@/components/logo";

const NAV_LINKS = [
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/#features", label: "Features" },
  { href: "/#stats", label: "Impact" },
];

interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

function getInitials(user: AuthUser): string {
  const source = (user.name?.trim() || user.email || "").trim();
  if (!source) return "?";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return source.charAt(0).toUpperCase();
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
    <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto grid h-[72px] max-w-[1440px] grid-cols-[auto_1fr_auto] items-center gap-6 px-6">
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
          {user === undefined ? (
            <div
              aria-hidden
              className="size-9 animate-pulse rounded-full bg-muted"
            />
          ) : user ? (
            <>
              <Link
                href="/report"
                className={`btn-cta btn-cta-dark ${pathname === "/report" ? "opacity-70" : ""}`}
              >
                Report Issue
                <ArrowRight className="size-3.5" />
              </Link>
              <UserMenu
                user={user}
                pathname={pathname}
                onLogout={handleLogout}
              />
            </>
          ) : (
            <>
              <Link
                href="/login"
                className={`font-mono text-xs font-medium uppercase tracking-wider transition-colors hover:text-foreground ${pathname === "/login" ? "text-foreground" : "text-muted-foreground"}`}
              >
                Sign in
              </Link>
              <Link
                href="/report"
                className={`btn-cta btn-cta-dark ${pathname === "/report" ? "opacity-70" : ""}`}
              >
                Report Issue
                <ArrowRight className="size-3.5" />
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

function UserMenu({
  user,
  pathname,
  onLogout,
}: {
  user: AuthUser;
  pathname: string;
  onLogout: () => Promise<void>;
}) {
  const initials = getInitials(user);
  const isOnDashboard = pathname === "/dashboard";

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Open account menu"
        className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 text-xs font-semibold tracking-wide text-white shadow-sm outline-none ring-offset-background transition hover:scale-[1.04] hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[popup-open]:ring-2 data-[popup-open]:ring-ring data-[popup-open]:ring-offset-2"
      >
        {initials}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={10}
          className="z-50"
        >
          <Menu.Popup className="min-w-64 origin-(--transform-origin) overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg ring-1 ring-black/[0.04] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <div className="flex items-center gap-3 border-b border-border px-3 py-3">
              <div
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 text-sm font-semibold text-white"
              >
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                {user.name ? (
                  <>
                    <p className="truncate text-sm font-medium leading-tight">
                      {user.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {user.email}
                    </p>
                  </>
                ) : (
                  <p className="truncate text-sm font-medium leading-tight">
                    {user.email}
                  </p>
                )}
              </div>
            </div>

            <div className="p-1">
              <Menu.LinkItem
                render={
                  <Link
                    href="/dashboard"
                    aria-current={isOnDashboard ? "page" : undefined}
                  />
                }
                closeOnClick
                className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground ${isOnDashboard ? "bg-muted" : ""}`}
              >
                <LayoutDashboard className="size-4 text-muted-foreground" />
                Dashboard
              </Menu.LinkItem>

              <Menu.Item
                onClick={onLogout}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <LogOut className="size-4 text-muted-foreground" />
                Sign out
              </Menu.Item>
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
