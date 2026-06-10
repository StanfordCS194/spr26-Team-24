"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { useI18n } from "@/i18n/provider";
import { safeRedirect } from "@/lib/utils";

export function LoginForm({
  googleEnabled = false,
}: {
  googleEnabled?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();

  // A failed Google round-trip comes back as ?error=google_… — surface one
  // friendly message rather than leaking the specific failure code.
  const oauthFailed = (searchParams.get("error") ?? "").startsWith("google_");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        setError(t("auth.loginFailed"));
        return;
      }

      const redirect = safeRedirect(searchParams.get("redirect"));
      router.push(redirect);
      router.refresh();
    } catch {
      setError(t("common.somethingWrong"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="ep-card p-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">
            {t("auth.welcomeBack")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("auth.signInSubtitle")}
          </p>
        </div>

        {oauthFailed && (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {t("auth.googleSignInFailed")}
          </p>
        )}

        {googleEnabled && (
          <div className="mb-6">
            <GoogleSignInButton redirect={searchParams.get("redirect")} />
            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                {t("auth.or")}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <Input
              id="password"
              type="password"
              placeholder={t("auth.passwordPlaceholder")}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t("auth.signingIn") : t("nav.signIn")}
          </Button>
        </form>
      </div>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        {t("auth.noAccount")}{" "}
        <Link
          href="/register"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t("auth.createOne")}
        </Link>
      </p>

      <p className="mt-2 text-center text-xs text-muted-foreground">
        Signed up before passwords were required?{" "}
        <Link href="/claim" className="underline-offset-4 hover:underline">
          Claim your account
        </Link>
      </p>
    </div>
  );
}
