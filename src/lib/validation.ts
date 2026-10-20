import { z } from "zod";

export const slug = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[-a-zA-Z0-9_]+$/, "slug may only contain letters, numbers, - and _");

export const uuid = z.uuid();

export const email = z.email();

const LOCALHOST = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https only, except localhost (for local development callbacks). */
export const secureUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" || (url.protocol === "http:" && LOCALHOST.has(url.hostname));
}, "URL must use https (http is only allowed for localhost)");

export const attributes = z.record(z.string(), z.unknown());

/** User reference: numeric pk, username or email. */
export const userRef = z
  .union([z.number().int().positive(), z.string().min(1).max(254)])
  .describe("User pk (number), username or email");

/** Group reference: uuid or exact name. */
export const groupRef = z.string().min(1).max(200).describe("Group uuid or exact group name");

/** ISO 8601 duration-ish values accepted by authentik, e.g. "days=7" or "hours=12". */
export const tokenDuration = z
  .string()
  .regex(/^(weeks|days|hours|minutes|seconds)=\d+(;(weeks|days|hours|minutes|seconds)=\d+)*$/)
  .describe('Validity, authentik timedelta syntax, e.g. "days=7" or "hours=1;minutes=30"');
