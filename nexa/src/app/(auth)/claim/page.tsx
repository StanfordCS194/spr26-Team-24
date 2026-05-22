import { ClaimForm } from "@/components/auth/claim-form";

export const metadata = {
  title: "Claim your account — Nexa",
};

export default function ClaimPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <ClaimForm />
    </main>
  );
}
