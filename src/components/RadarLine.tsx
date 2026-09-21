import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Radar } from "lucide-react";
import { loadRadarCounts } from "@/lib/prospectsData";
import { radarLine } from "@/lib/prospects";

/**
 * The one line above the My patch table (Prospecting, slice 3): "The radar
 * added N companies this week and has M more ready", linking to the
 * Prospects page. Nothing is shown while loading or when the read fails,
 * so the patch never waits on the radar.
 */
export function RadarLine() {
  const { data } = useQuery({ queryKey: ["radar-counts"], queryFn: () => loadRadarCounts(), staleTime: 300_000, retry: false });
  if (!data) return null;
  return (
    <p className="text-sm text-foreground">
      <Radar className="mr-1.5 inline h-4 w-4 text-primary" aria-hidden="true" />
      {radarLine(data)}{" "}
      <Link to="/prospects" className="font-medium text-primary hover:underline">Open the prospects</Link>
    </p>
  );
}
