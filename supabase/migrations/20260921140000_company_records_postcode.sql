-- The register cache writes the registered office postcode as its own
-- column (companies-house.ts recordToRow); the baseline only had the
-- district. Found on the first live analysis, 21 September 2026.
alter table public.company_records add column if not exists postcode text;
