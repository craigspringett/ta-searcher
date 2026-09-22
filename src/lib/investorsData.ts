import { supabase } from "@/integrations/supabase/client";
import type { AnalysisResult } from "@/lib/analysis";
import { groupByInvestor, investorsOf, type InvestorGroup } from "@/lib/investors";
import { latestRaiseLine, stageLabel } from "@/lib/patch";

/** Every fund named in a tracked company's analysis, with its companies. */
export async function loadInvestors(): Promise<{ groups: InvestorGroup[]; companies: number; withInvestors: number }> {
  const [companies, scores] = await Promise.all([
    supabase.from("company_searches").select("id, company_name, analysis_result, pipeline_stage"),
    supabase.from("company_scores").select("company_search_id, score"),
  ]);
  if (companies.error) throw new Error(companies.error.message);
  if (scores.error) throw new Error(scores.error.message);
  const scoreById = new Map((scores.data || []).map((s) => [s.company_search_id, s.score]));
  const rows = (companies.data || []).map((c) => {
    const ar = (c.analysis_result || null) as unknown as AnalysisResult | null;
    return {
      company: {
        id: c.id,
        name: ar?.companyRecord?.name || c.company_name,
        fundingStage: stageLabel(ar?.stage?.label),
        raise: ar?.latestRaise ? latestRaiseLine(ar.latestRaise) : null,
        score: scoreById.get(c.id) ?? null,
        pipelineStage: (c as { pipeline_stage?: string }).pipeline_stage ?? null,
      },
      investors: investorsOf(ar),
    };
  });
  return { groups: groupByInvestor(rows), companies: rows.length, withInvestors: rows.filter((r) => r.investors.length > 0).length };
}
