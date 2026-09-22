import { companyLinkedIn } from "@/lib/linkedin";
import { ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { companiesHouseUrl, companyIsClosed, companyStatusLabel, registeredOfficeLine, type CompanyRecord, type LatestRaise, type StageGuess } from "@/lib/analysis";
import { formatLongDate, latestRaiseDetail, latestRaiseLine, stageLabel } from "@/lib/patch";
import { sectorFromSic } from "@/lib/sector";

interface Props {
  /** The company's LinkedIn page from the analysis, else a search is offered. */
  linkedin?: string | null;
  summary: string;
  url: string;
  record: CompanyRecord | null | undefined;
  stage: StageGuess | null | undefined;
  raise: LatestRaise | null | undefined;
  websiteAccess?: string | null;
}

/**
 * The summary card: the written summary, then the register line from
 * Companies House (number, status, incorporated, registered office, sector),
 * the stage with its evidence and the latest raise.
 */
export function CompanyRegisterCard({ summary, url, record, stage, raise, websiteAccess, linkedin }: Props) {
  const sector = sectorFromSic(record?.sicCodes);
  const office = registeredOfficeLine(record);
  const closed = companyIsClosed(record?.status);
  const raiseLine = latestRaiseLine(raise);
  const raiseDetail = latestRaiseDetail(raise);
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })();
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
  return (
    <Card className="p-6 scroll-mt-14" id="summary">
      <h3 className="text-lg font-bold text-foreground mb-3">Summary</h3>
      {websiteAccess && <p className="mb-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">The website {websiteAccess}; the register, the careers feeds and the team's notes still come through.</p>}
      <p className="text-sm text-foreground leading-relaxed">{summary}</p>

      <h4 className="mt-4 mb-2 text-sm font-semibold text-foreground">Companies House</h4>
      {!record ? (
        <p className="text-xs text-muted-foreground">No register entry: the company was added by website address ({host}) without a company number. Add the number to read its officers and filings.</p>
      ) : record.verified === false ? (
        <p className="text-xs text-warning">Companies House record not read{record.note ? `: ${record.note}` : ""}. Number {record.companyNumber}.</p>
      ) : (
        <dl className="space-y-1">
          <Row label="Name">{record.name}{(record.previousNames?.length || 0) > 0 && <span className="text-muted-foreground"> (formerly {record.previousNames!.join(", ")})</span>}</Row>
          <Row label="Number">
            <a href={companiesHouseUrl(record.companyNumber)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              {record.companyNumber}<ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </Row>
          <Row label="Status"><span className={closed ? "font-medium text-critical" : ""}>{companyStatusLabel(record.status) || "Unknown"}</span>{closed && <span className="text-xs text-muted-foreground"> (not refreshed, alerted or scored again)</span>}</Row>
          <Row label="Incorporated">{record.incorporationDate ? formatLongDate(record.incorporationDate) : "Unknown"}</Row>
          {(() => {
            const li = companyLinkedIn(linkedin, record.name);
            return li ? (
              <Row label="LinkedIn">
                <a href={li.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  {li.kind === "page" ? "Company page" : "Search LinkedIn"}<ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </Row>
            ) : null;
          })()}
          <Row label="Registered office">{office || "Not given"}</Row>
          <Row label="Sector">{sector || <span className="text-muted-foreground">Not one we label{record.sicCodes?.length ? ` (SIC ${record.sicCodes.join(", ")})` : ""}</span>}{sector && record.sicCodes?.length ? <span className="text-xs text-muted-foreground"> (SIC {record.sicCodes.join(", ")})</span> : null}</Row>
          {record.accountsType && <Row label="Accounts">{record.accountsType}{record.lastAccountsMadeUpTo ? ` to ${formatLongDate(record.lastAccountsMadeUpTo)}` : ""}</Row>}
        </dl>
      )}

      <h4 className="mt-4 mb-2 text-sm font-semibold text-foreground">Stage and money</h4>
      <dl className="space-y-1">
        <Row label="Stage">
          {stageLabel(stage?.label)}
          {stage?.evidence && <span className="block text-xs text-muted-foreground">{stage.evidence}{stage.source_url && /^https?:/.test(stage.source_url) && <> · <a href={stage.source_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">source</a></>}</span>}
        </Row>
        <Row label="Latest raise">
          {raise ? (
            <>
              <span className="font-medium">{raiseLine || "A round, size not stated"}</span>
              {raiseDetail && <span className="text-muted-foreground"> · {raiseDetail}</span>}
              {raise.statement && <span className="block text-xs text-muted-foreground">“{raise.statement}”{raise.source_url && /^https?:/.test(raise.source_url) && <> · <a href={raise.source_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">source</a></>}</span>}
            </>
          ) : (
            <span className="text-muted-foreground">No round found on the website</span>
          )}
        </Row>
        <Row label="Website"><a href={url} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">{host}</a></Row>
      </dl>
    </Card>
  );
}
