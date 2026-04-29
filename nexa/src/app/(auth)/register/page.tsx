// /register — rendered as a server component
// The (auth) folder is a route group: it organises auth pages without affecting their URLs.

import { RegisterForm } from "@/components/auth/register-form";

export const metadata = {
  title: "Create account — Nexa",
};

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <RegisterForm />
    </main>
  );
}
