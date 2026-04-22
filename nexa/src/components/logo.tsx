import Link from "next/link";

export function Logo({ className = "text-xl" }: { className?: string }) {
  return (
    <Link href="/">
      <span
        className={`bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 bg-clip-text font-bold tracking-tight text-transparent ${className}`}
      >
        Nexa
      </span>
    </Link>
  );
}
