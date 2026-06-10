import { setupServer } from "msw/node";

import { handlers } from "./handlers";

// The node-side MSW server used by vitest (lib + API route tests). Its
// lifecycle (listen / resetHandlers / close) is wired in vitest.setup.tsx.
export const server = setupServer(...handlers);
