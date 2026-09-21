import { describe, expect, it } from "vitest";
import { greeting } from "../outreach";

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
