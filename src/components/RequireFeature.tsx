import { Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { hasFeature, type FeatureName } from "@/lib/features";
import NotFound from "@/pages/NotFound";

/**
 * Route guard for a hidden feature: with the flag off the route renders the
 * ordinary 404 page, so nothing reveals the feature exists. Sits inside
 * RequireAuth, so the profile is already loaded.
 */
export function RequireFeature({ feature }: { feature: FeatureName }) {
  const { profile } = useAuth();
  if (!hasFeature(profile, feature)) return <NotFound />;
  return <Outlet />;
}
