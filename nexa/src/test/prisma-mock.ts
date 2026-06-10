import type { PrismaClient } from "@/generated/prisma/client";
import { beforeEach, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";

// ---------------------------------------------------------------------------
// Prisma test strategy: we deep-mock the singleton `@/lib/prisma` rather than
// spinning up an ephemeral database. See src/test/README.md for the rationale.
//
// `mockDeep<PrismaClient>()` produces a fully-typed proxy where every method
// (e.g. prisma.report.create) is a vi.fn() you can stub with .mockResolvedValue.
// ---------------------------------------------------------------------------
export const prismaMock: DeepMockProxy<PrismaClient> = mockDeep<PrismaClient>();

// Replace the real singleton with our deep mock. `vi.mock` is hoisted, so this
// call sits at module top level and applies to any test file that imports this
// module. The factory references `prismaMock` lazily via getter to dodge the
// hoisting/TDZ problem.
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return prismaMock;
  },
}));

/**
 * Reset all stubbed implementations and call history on the Prisma mock.
 * Call from a test's `beforeEach` (or rely on the global one below) so state
 * never leaks between tests.
 */
export function resetPrismaMock(): void {
  mockReset(prismaMock);
}

// Auto-reset between tests for any file that imports this module.
beforeEach(() => {
  resetPrismaMock();
});
