// /register — rendered as a server component
// The (auth) folder is a route group: it organises auth pages without affecting their URLs.

import { RegisterForm } from "@/components/auth/register-form";
import { isGoogleOAuthConfigured } from "@/lib/config";

export const metadata = {
  title: "Create account — Nexa",
};

export default function RegisterPage() {
  const googleEnabled = isGoogleOAuthConfigured();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <RegisterForm googleEnabled={googleEnabled} />
    </main>
  );
}
