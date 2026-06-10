import { z } from "zod";
import { IssueType } from "@/generated/prisma/enums";

/**
 * Per-route request schemas. Each route declares its body shape here once and
 * parses through `parseRequestBody`, replacing the inline `as { ... }` casts
 * and ad-hoc `typeof`/enum narrowing that previously lived in the handlers.
 *
 * Field optionality mirrors the contracts the routes already accepted. On top
 * of typing and `issueType` enum validation, this layer enforces the runtime
 * bounds from #106 — out-of-range coordinates and over-long descriptions are
 * rejected here so every route returns the same 400 envelope instead of
 * letting bad data reach routing/geospatial code or the LLM prompt.
 */

/**
 * Max accepted length for a user-supplied free-text description. Over-length
 * input is rejected with a 400 rather than truncated, so the report the user
 * sees persisted matches what they typed. This is also the first line of
 * defense against prompt-injection payloads that try to balloon token cost;
 * the providers apply a defensive cap of their own (see `sanitizeUserText`).
 */
export const MAX_DESCRIPTION_LENGTH = 2000;

/** Latitude in valid WGS84 range, with a message the 400 envelope surfaces. */
const latitudeSchema = z
  .number()
  .min(-90, { error: "latitude must be between -90 and 90." })
  .max(90, { error: "latitude must be between -90 and 90." });

/** Longitude in valid WGS84 range. */
const longitudeSchema = z
  .number()
  .min(-180, { error: "longitude must be between -180 and 180." })
  .max(180, { error: "longitude must be between -180 and 180." });

/** Free-text description capped at {@link MAX_DESCRIPTION_LENGTH} characters. */
const descriptionSchema = z.string().max(MAX_DESCRIPTION_LENGTH, {
  error: `description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
});

/** `POST /api/reports` — create a report. */
export const CreateReportSchema = z.object({
  description: descriptionSchema.optional(),
  aiDescription: z.string().optional(),
  issueType: z.enum(IssueType).optional(),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  address: z.string().optional(),
  imageUrl: z.string().optional(),
});
export type CreateReportInput = z.infer<typeof CreateReportSchema>;

/** `POST /api/reports/classify` — classify a description/image. */
export const ClassifyRequestSchema = z.object({
  description: descriptionSchema.optional(),
  imageBase64: z.string().optional(),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  address: z.string().optional(),
  jurisdiction: z.string().optional(),
});
export type ClassifyRequestInput = z.infer<typeof ClassifyRequestSchema>;

/** `POST /api/reports/form-link` — look up an official city form. */
export const FormLinkRequestSchema = z.object({
  issueType: z.enum(IssueType).optional(),
  address: z.string().optional(),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
});
export type FormLinkRequestInput = z.infer<typeof FormLinkRequestSchema>;

/** `POST /api/auth/register` — create an account. */
export const RegisterSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  password: z.string().optional(),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

/** `POST /api/auth/login` — authenticate an existing account. */
export const LoginSchema = z.object({
  email: z.string().optional(),
  password: z.string().optional(),
});
export type LoginInput = z.infer<typeof LoginSchema>;

/** `POST /api/auth/claim` — set a password on a passwordless account. */
export const ClaimSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  password: z.string().optional(),
  // Anonymous reports filed as a guest, to attach to the claimed account (#17).
  reportIds: z.array(z.string()).optional(),
});
export type ClaimInput = z.infer<typeof ClaimSchema>;

/** `POST /api/reports/[id]/resolution` — mark a report resolved/unresolved. */
export const ResolutionSchema = z.object({
  resolved: z.boolean({
    error: "Field `resolved` must be a boolean.",
  }),
});
export type ResolutionInput = z.infer<typeof ResolutionSchema>;

/**
 * `POST /api/push/subscribe` — store a browser Web Push subscription (#38).
 * Shape mirrors the JSON produced by `PushSubscription.toJSON()` in the browser.
 */
export const PushSubscribeSchema = z.object({
  endpoint: z.string().min(1, "endpoint is required"),
  keys: z.object({
    p256dh: z.string().min(1, "keys.p256dh is required"),
    auth: z.string().min(1, "keys.auth is required"),
  }),
});
export type PushSubscribeInput = z.infer<typeof PushSubscribeSchema>;

/** `POST /api/push/unsubscribe` — drop a stored subscription by endpoint. */
export const PushUnsubscribeSchema = z.object({
  endpoint: z.string().min(1, "endpoint is required"),
});
export type PushUnsubscribeInput = z.infer<typeof PushUnsubscribeSchema>;
