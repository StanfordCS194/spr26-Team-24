import type { Open311Config } from "@/lib/submission/open311";

/** A minimal Open311 agency config pointing at the public sandbox. */
export const open311Config: Open311Config = {
  endpoint: "https://sandbox.open311.org/v2",
  apiKey: "test-api-key",
  jurisdictionId: "city-palo-alto",
  serviceCodes: {
    ROAD_DAMAGE: "POTHOLES",
  },
};

/**
 * Wire-shape responses as the GeoReport v2 endpoints return them. Use with MSW
 * to stub `POST /requests.json` and `GET /requests/{id}.json`.
 */
export const open311Responses = {
  // POST /requests.json — array with the new service_request_id.
  createSuccess: [{ service_request_id: "REQ-12345" }],
  // POST /requests.json — token-based async acknowledgement.
  createWithToken: [{ token: "tok_abc123" }],
  // GET /requests/{id}.json — an open request.
  statusOpen: [
    {
      service_request_id: "REQ-12345",
      status: "open",
      status_notes: "Received and queued for inspection.",
    },
  ],
  // GET /requests/{id}.json — a closed/resolved request.
  statusClosed: [
    {
      service_request_id: "REQ-12345",
      status: "closed",
      status_notes: "Pothole filled.",
    },
  ],
} as const;
