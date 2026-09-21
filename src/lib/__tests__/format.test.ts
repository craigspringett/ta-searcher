import { describe, expect, it } from "vitest";
import { describeFunctionError, formatIsoDateUk } from "../format";

describe("format", () => {
  it("formats ISO dates the UK way and passes anything else through", () => {
    expect(formatIsoDateUk("2026-09-11")).toBe("Fri, 11 Sept 2026");
    expect(formatIsoDateUk("soon")).toBe("soon");
    expect(formatIsoDateUk(null)).toBe("");
  });

  it("pulls the function's own error message out of a failed call", async () => {
    const ctx = new Response(JSON.stringify({ error: "You have started 10 analyses in the last hour." }), { status: 429 });
    expect(await describeFunctionError({ context: ctx })).toBe("You have started 10 analyses in the last hour.");
    expect(await describeFunctionError(new Error("boom"))).toBe("boom");
  });
});
