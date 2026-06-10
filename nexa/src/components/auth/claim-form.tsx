"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ApiResponse } from "@/lib/api/response";
import {
  clearPendingReportIds,
  getPendingReportIds,
} from "@/lib/pending-reports";
import { useI18n } from "@/i18n/provider";

export function ClaimForm() {
  const router = useRouter();
  const { t } = useI18n();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Hand over any reports filed anonymously so they're attached to this
      // account. Empty when the user reached /claim directly (the original
      // passwordless-account flow), which keeps that path unchanged.
      const reportIds = getPendingReportIds();

      const res = await fetch("/api/auth/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          name: name || undefined,
          ...(reportIds.length > 0 ? { reportIds } : {}),
        }),
      });

      const payload = (await res.json()) as ApiResponse<unknown>;

      if (!res.ok || !payload.success) {
        setError(!payload.success ? payload.error : t("auth.claimFailed"));
        return;
      }

      clearPendingReportIds();
      router.push("/dashboard");
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
            {t("auth.claimTitle")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("auth.claimSubtitle")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input
              id="email"
              type="email"
              placeholder={t("auth.emailPlaceholder")}
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="name">{t("auth.nameOptional")}</Label>
            <Input
              id="name"
              type="text"
              placeholder={t("auth.namePlaceholder")}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">{t("auth.newPassword")}</Label>
            <Input
              id="password"
              type="password"
              placeholder={t("auth.passwordNewPlaceholder")}
              autoComplete="new-password"
              required
              minLength={8}
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
            {loading ? t("auth.settingPassword") : t("auth.setPassword")}
          </Button>
        </form>
      </div>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        {t("auth.hasPassword")}{" "}
        <Link
          href="/login"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t("nav.signIn")}
        </Link>
      </p>
    </div>
  );
}
