// /login — rendered as a server component (no "use client" needed here)
// The (auth) folder is a Next.js route group: it organises files but doesn't affect the URL.
// The actual interactive form lives in LoginForm (a client component).

import { LoginForm } from "@/components/auth/login-form";
import { Suspense } from "react";

export const metadata = {
  title: "Sign in — Nexa",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      {/* Suspense is required because LoginForm uses useSearchParams() */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
