import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

import "./src/test/env";
import { server } from "./src/test/msw/server";

// ---------------------------------------------------------------------------
// localStorage polyfill (jsdom project). Newer Node ships a native, file-backed
// localStorage that shadows jsdom's and throws when no file path is set. Replace
// it with a simple in-memory implementation so client code (e.g. the i18n
// provider reading a stored locale) works in tests.
// ---------------------------------------------------------------------------
if (typeof window !== "undefined") {
  const memoryStorage = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
      get length() {
        return Object.keys(store).length;
      },
    } satisfies Storage;
  })();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: memoryStorage,
  });
}

// ---------------------------------------------------------------------------
// MSW: no real network in any test. Start once, reset between tests so a
// handler added inside one test never leaks into the next, stop at the end.
// ---------------------------------------------------------------------------
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  // RTL auto-cleanup: unmount React trees between tests.
  cleanup();
});
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Global Next.js mocks. These run in both projects; the jsdom project needs
// them for components, and the node project tolerates them harmlessly.
// ---------------------------------------------------------------------------

// next/navigation — App Router client hooks have no provider in a unit test.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

// next/headers — `cookies()` is async in this Next version. Default to an empty
// store; individual tests override with vi.mocked(cookies) as needed.
vi.mock("next/headers", () => {
  const store = {
    get: vi.fn(() => undefined),
    getAll: vi.fn(() => []),
    has: vi.fn(() => false),
    set: vi.fn(),
    delete: vi.fn(),
  };
  return {
    cookies: vi.fn(async () => store),
    headers: vi.fn(async () => new Headers()),
  };
});

// next/image — render a plain <img> so jsdom doesn't choke on the loader.
vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));
