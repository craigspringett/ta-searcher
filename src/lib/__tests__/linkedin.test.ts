import { describe, expect, it } from "vitest";
import { companyLinkedIn, contactLinkedIn, linkedInPeopleSearchUrl } from "../linkedin";

describe("linkedin", () => {
  it("opens the stored profile, else a people search for the name and company", () => {
    expect(contactLinkedIn({ name: "Priya Shah", linkedin: "https://www.linkedin.com/in/priya-shah/" }, "Metris Energy")).toEqual({ url: "https://www.linkedin.com/in/priya-shah/", kind: "profile" });
    expect(contactLinkedIn({ name: "Priya Shah" }, "Metris Energy")).toEqual({ url: linkedInPeopleSearchUrl("Priya Shah", "Metris Energy"), kind: "search" });
    expect(contactLinkedIn({ name: "Priya Shah" }, "Metris Energy")!.url).toBe("https://www.linkedin.com/search/results/people/?keywords=Priya%20Shah%20Metris%20Energy");
    expect(contactLinkedIn({ name: "" }, "Metris Energy")).toBeNull();
  });
  it("opens the company page, else a company search", () => {
    expect(companyLinkedIn("https://www.linkedin.com/company/metris-energy/", "Metris Energy")).toEqual({ url: "https://www.linkedin.com/company/metris-energy/", kind: "page" });
    expect(companyLinkedIn(null, "Metris Energy")).toEqual({ url: "https://www.linkedin.com/search/results/companies/?keywords=Metris%20Energy", kind: "search" });
    expect(companyLinkedIn(null, null)).toBeNull();
  });
});
