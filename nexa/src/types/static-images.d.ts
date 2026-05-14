// Type declarations for Next.js static-asset imports. The matching
// declarations live in `next-env.d.ts`, which Next.js auto-generates on `next
// dev` / `next build` but is gitignored — so CI's `tsc --noEmit` step (which
// runs without ever building Next) needs an in-repo copy.

declare module "*.png" {
  const content: {
    src: string;
    height: number;
    width: number;
    blurDataURL?: string;
  };
  export default content;
}
