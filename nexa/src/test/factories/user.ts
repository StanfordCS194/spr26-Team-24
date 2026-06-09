import type { User } from "@/generated/prisma/client";

let seq = 0;

/**
 * Build a fully-populated `User` row. Pass `overrides` to pin any field.
 * Deterministic: ids/emails are sequence-based, timestamps are fixed.
 */
export function makeUser(overrides: Partial<User> = {}): User {
  seq += 1;
  const createdAt = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: `user_${seq}`,
    email: `user${seq}@example.com`,
    name: `Test User ${seq}`,
    // bcrypt hash of "password" — present so auth code has something to read.
    passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}
