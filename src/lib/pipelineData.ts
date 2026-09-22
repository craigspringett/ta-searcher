import { supabase } from "@/integrations/supabase/client";
import { loadPatch } from "@/lib/patch";
import { stageOf, type PipelineCompany, type PipelineStage } from "@/lib/pipeline";

/** The board's rows: My patch's derived fields plus the stage on each company row. */
export async function loadPipeline(): Promise<PipelineCompany[]> {
  const [patch, stages] = await Promise.all([
    loadPatch(),
    supabase.from("company_searches").select("id, pipeline_stage, pipeline_moved_at"),
  ]);
  if (stages.error) throw new Error(stages.error.message);
  const stageById = new Map((stages.data || []).map((r) => [r.id, r]));
  return patch.companies.map((c) => {
    const s = stageById.get(c.id);
    return {
      id: c.id,
      name: c.name,
      stage: stageOf(s?.pipeline_stage),
      movedAt: s?.pipeline_moved_at ?? null,
      sector: c.sector,
      fundingStage: c.stage,
      score: c.propensity,
      lastOutcome: c.lastOutcome,
      nextCallback: c.nextCallback,
      openRoles: c.openRoles,
    };
  });
}

/** One company's stage, for the control on its page. */
export async function loadCompanyStage(companyId: string): Promise<{ stage: PipelineStage; movedAt: string | null }> {
  const { data, error } = await supabase.from("company_searches").select("pipeline_stage, pipeline_moved_at").eq("id", companyId).maybeSingle();
  if (error) throw new Error(error.message);
  return { stage: stageOf(data?.pipeline_stage), movedAt: data?.pipeline_moved_at ?? null };
}

/** Move a company to a stage. A count of 0 means row security refused it. */
export async function moveCompanyStage(companyId: string, stage: PipelineStage): Promise<void> {
  const { error, count } = await supabase.from("company_searches").update({ pipeline_stage: stage }, { count: "exact" }).eq("id", companyId);
  if (error) throw new Error(error.message);
  if (count === 0) throw new Error("Not moved. Only a signed-in app user can move a company.");
}
