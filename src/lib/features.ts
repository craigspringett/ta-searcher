import type { Json } from "@/integrations/supabase/types";

/**
 * Per-user feature flags, from profiles.features ({"crm_shortlister": true}).
 * The profile is already loaded for every signed-in page (select *), so
 * checking a flag costs no query. Off is the default for everyone: a
 * missing column, a null, a non-object or any value but `true` is off.
 */
export type FeatureName = "crm_shortlister" | "follow_ups";

export function hasFeature(profile: { features?: Json | null } | null | undefined, name: FeatureName): boolean {
  const f = profile?.features;
  if (!f || typeof f !== "object" || Array.isArray(f)) return false;
  return (f as Record<string, Json | undefined>)[name] === true;
}
