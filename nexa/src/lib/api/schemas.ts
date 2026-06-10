import { z } from "zod";
import { IssueType } from "@/generated/prisma/enums";

/**
 * Per-route request schemas. Each route declares its body shape here once and
 * parses through `parseRequestBody`, replacing the inline `as { ... }` casts
 * and ad-hoc `typeof`/enum narrowing that previously lived in the handlers.
 *
 * Field optionality mirrors the contracts the routes already accepted; this
 * layer adds typing and `issueType` enum validation, not new runtime bounds
 * (those are tracked separately in #106).
 */

/** `POST /api/reports` — create a report. */
export const CreateReportSchema = z.object({
  description: z.string().optional(),
  aiDescription: z.string().optional(),
  issueType: z.enum(IssueType).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  address: z.string().optional(),
  imageUrl: z.string().optional(),
});
export type CreateReportInput = z.infer<typeof CreateReportSchema>;

/** `POST /api/reports/classify` — classify a description/image. */
export const ClassifyRequestSchema = z.object({
  description: z.string().optional(),
  imageBase64: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  address: z.string().optional(),
  jurisdiction: z.string().optional(),
});
export type ClassifyRequestInput = z.infer<typeof ClassifyRequestSchema>;

/** `POST /api/reports/form-link` — look up an official city form. */
export const FormLinkRequestSchema = z.object({
  issueType: z.enum(IssueType).optional(),
  address: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
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

/** `POST /api/reports/[id]/resolution` — mark a report resolved/unresolved. */
export const ResolutionSchema = z.object({
  resolved: z.boolean({
    error: "Field `resolved` must be a boolean.",
  }),
});
export type ResolutionInput = z.infer<typeof ResolutionSchema>;
