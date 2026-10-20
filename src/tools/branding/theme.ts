import { z } from "zod";
import { resolveUser } from "@/lib/authentik/resolve";
import {
  defaultBrandWarning,
  diffFields,
  mergeAttributes,
  resolveBrand,
} from "@/lib/branding/brands";
import { confirmField, dryRun } from "@/lib/safety/confirm";
import { userRef } from "@/lib/validation";
import { defineTool } from "../define-tool";
import { autoSnapshot, brandRef } from "./shared";

const theme = z.enum(["automatic", "light", "dark"]);
const locale = z
  .string()
  .regex(/^[a-z]{2,3}([_-][A-Za-z]{2,4})?$/, 'locale code like "pt", "pt-BR", "en"');

function settingsPatch(args: { theme?: string; locale?: string }) {
  return {
    settings: {
      ...(args.theme ? { theme: { base: args.theme } } : {}),
      ...(args.locale ? { locale: args.locale } : {}),
    },
  };
}

export const setThemeDefaults = defineTool({
  name: "authentik_branding_set_theme_defaults",
  domain: "branding",
  kind: "destructive",
  idempotent: true,
  title: "Set brand theme and language",
  description:
    "Set the brand's default theme (automatic/light/dark) and locale via attributes " +
    "settings.theme.base / settings.locale. Merges with existing attributes (never drops keys).",
  input: z.object({
    brand: brandRef,
    theme: theme.optional(),
    locale: locale.optional(),
    confirm: confirmField,
  }),
  handler: async (args, { client }) => {
    const brand = await resolveBrand(client, args.brand);
    const attributes = mergeAttributes(brand.attributes, settingsPatch(args));
    const diff = diffFields({ attributes: brand.attributes }, { attributes });
    if (Object.keys(diff).length === 0) return { changed: false };
    if (!args.confirm)
      return dryRun([`Update theme/locale of ${brand.domain}`], diff, defaultBrandWarning(brand));
    const snapshot = await autoSnapshot(client, brand);
    await client.patch(`/core/brands/${brand.brand_uuid}/`, { attributes });
    return { changed: true, snapshot, attributes };
  },
});

export const setUserTheme = defineTool({
  name: "authentik_branding_set_user_theme",
  domain: "branding",
  kind: "write",
  idempotent: true,
  title: "Set a user's theme and language",
  description: "Override theme and/or locale for one user (merged into the user's attributes).",
  input: z.object({ user: userRef, theme: theme.optional(), locale: locale.optional() }),
  handler: async (args, { client }) => {
    const user = await resolveUser(client, args.user);
    const attributes = mergeAttributes(user.attributes, settingsPatch(args));
    await client.patch(`/core/users/${user.pk}/`, { attributes });
    return { changed: true, username: user.username, settings: attributes.settings };
  },
});
