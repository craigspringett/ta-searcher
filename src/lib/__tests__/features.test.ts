import { describe, expect, it } from "vitest";
import { hasFeature } from "../features";

describe("hasFeature", () => {
  it("is off unless the flag is exactly true", () => {
    expect(hasFeature(null, "crm_shortlister")).toBe(false);
    expect(hasFeature(undefined, "crm_shortlister")).toBe(false);
    expect(hasFeature({}, "crm_shortlister")).toBe(false);
    expect(hasFeature({ features: null }, "crm_shortlister")).toBe(false);
    expect(hasFeature({ features: {} }, "crm_shortlister")).toBe(false);
    expect(hasFeature({ features: [] }, "crm_shortlister")).toBe(false);
    expect(hasFeature({ features: "crm_shortlister" }, "crm_shortlister")).toBe(false);
    expect(hasFeature({ features: { crm_shortlister: "true" } }, "crm_shortlister")).toBe(false);
    expect(hasFeature({ features: { crm_shortlister: 1 } }, "crm_shortlister")).toBe(false);
    expect(hasFeature({ features: { other: true } }, "crm_shortlister")).toBe(false);
    expect(hasFeature({ features: { follow_ups: "true" } }, "follow_ups")).toBe(false);
    expect(hasFeature({ features: { crm_shortlister: true } }, "follow_ups")).toBe(false);
  });
  it("is on when the profile carries the flag", () => {
    expect(hasFeature({ features: { crm_shortlister: true } }, "crm_shortlister")).toBe(true);
    expect(hasFeature({ features: { crm_shortlister: true, other: false } }, "crm_shortlister")).toBe(true);
    expect(hasFeature({ features: { follow_ups: true } }, "follow_ups")).toBe(true);
    expect(hasFeature({ features: { follow_ups: true, crm_shortlister: false } }, "follow_ups")).toBe(true);
  });
});
