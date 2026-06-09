import { setupWorker } from "msw/browser";

import { handlers } from "./handlers";

// Browser-side MSW worker, available for Playwright e2e tests that want to stub
// network in the page context. Not wired up automatically — import and start it
// from an e2e fixture when a spec needs it.
export const worker = setupWorker(...handlers);
