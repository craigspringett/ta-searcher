import { describe, expect, it } from "vitest";
import { greeting, clipboardText } from "../outreach";

describe("greeting", () => {
  it("keeps a title with the surname and uses a first name otherwise", () => {
    expect(greeting("Mrs Patel")).toBe("Dear Mrs Patel,");
    expect(greeting("Dr S Khan")).toBe("Dear Dr Khan,");
    expect(greeting("Sam Jones")).toBe("Dear Sam,");
    expect(greeting("Sam")).toBe("Dear Sam,");
    expect(greeting("")).toBe("Hello,");
    expect(greeting(null)).toBe("Hello,");
  });
});

describe("clipboardText", () => {
  it("puts the subject first, then the email, then the signature the template would add", () => {
    expect(clipboardText(" The six roles since the seed ", "Dear Priya,\n\nText.\n\nBest wishes,", { name: "Craig Springett", firm: "Big Fish Recruitment", phone: "07700 900000" })).toBe(
      "Subject: The six roles since the seed\n\nDear Priya,\n\nText.\n\nBest wishes,\nCraig Springett\nBig Fish Recruitment\n07700 900000",
    );
    expect(clipboardText("S", "Body", { name: "Craig", firm: "Big Fish Recruitment", phone: "  " })).toBe("Subject: S\n\nBody\nCraig\nBig Fish Recruitment");
  });
});
