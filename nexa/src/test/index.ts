// Barrel for the test toolkit. Import everything a test needs from "@/test".
//
//   import { renderWithProviders, prismaMock, makeUser, server } from "@/test";

// Render + RTL surface (jsdom project).
export * from "./render";

// Prisma deep-mock singleton + reset helper (auto-mocks @/lib/prisma on import).
export * from "./prisma-mock";

// MSW node server + handler helpers.
export { server } from "./msw/server";
export {
  handlers,
  jsonGet,
  jsonPost,
  http,
  HttpResponse,
} from "./msw/handlers";

// Factories.
export { makeUser } from "./factories/user";
export { makeReport } from "./factories/report";
export { makeAgency } from "./factories/agency";

// Fixtures.
export {
  classificationResult,
  providerResults,
  comparisonResult,
} from "./fixtures/classification";
export { open311Config, open311Responses } from "./fixtures/open311";
export {
  geoFeatureCollection,
  pointInside,
  pointOutside,
} from "./fixtures/geo";
