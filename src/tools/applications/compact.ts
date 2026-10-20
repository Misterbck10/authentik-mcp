import type { Schema } from "@/lib/authentik/types";

export function compactApplication(app: Schema<"Application">) {
  return {
    pk: app.pk,
    slug: app.slug,
    name: app.name,
    launchUrl: app.launch_url || app.meta_launch_url || null,
    group: app.group || undefined,
    description: app.meta_description || undefined,
    publisher: app.meta_publisher || undefined,
    hidden: app.meta_hide ?? false,
    icon: app.meta_icon_url || undefined,
    policyEngineMode: app.policy_engine_mode,
    provider: app.provider_obj
      ? {
          pk: app.provider_obj.pk,
          name: app.provider_obj.name,
          type: app.provider_obj.verbose_name,
        }
      : null,
    backchannelProviders:
      app.backchannel_providers_obj?.map((p) => ({ pk: p.pk, name: p.name })) ?? [],
  };
}
