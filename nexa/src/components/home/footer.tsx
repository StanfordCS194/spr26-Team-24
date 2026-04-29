import { Logo } from "@/components/logo";

export function Footer() {
  return (
    <footer className="w-full border-t border-border px-6 py-10">
      <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-4 sm:flex-row">
        <Logo className="text-lg" />
        <p className="text-sm text-muted-foreground">
          A Stanford CS 194 project.
        </p>
      </div>
    </footer>
  );
}
