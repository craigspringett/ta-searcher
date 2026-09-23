import { describe, expect, it } from "vitest";
import { connectionLine, parseReplyRow, replyRead, replyWho } from "../inbox";

describe("inbox", () => {
  it("parses a row and names the person", () => {
    const r = parseReplyRow({ id: "1", company_search_id: "c", contact_name: null, from_email: "priya@metris.example", from_name: null, subject: "Re: x", received_at: "2026-09-22T09:00:00Z", preview: null, body_text: "Thanks", match_note: "someone at metris.example; read: interested", sequence_id: null, draft_subject: "Re: x", draft_body: "Hi Priya,", draft_flags: null, draft_error: null, handled_at: null });
    expect(r.draftFlags).toEqual([]);
    expect(replyWho(r)).toBe("priya");
    expect(replyWho({ contactName: "Priya Shah", fromName: null, fromEmail: "x@y" })).toBe("Priya Shah");
    expect(replyRead(r.matchNote)).toBe("interested");
    expect(replyRead("a contact on the company")).toBeNull();
  });
  it("describes the connection", () => {
    expect(connectionLine(null, false)).toMatch(/not set up/);
    expect(connectionLine(null, true)).toMatch(/^Not connected/);
    expect(connectionLine({ mailbox: "craig@bigfishrecruitment.co.uk", status: "needs_reconnect", lastError: "invalid_grant", lastCheckedAt: null, connectedAt: "" }, true)).toBe("Outlook for craig@bigfishrecruitment.co.uk needs connecting again (invalid_grant).");
    expect(connectionLine({ mailbox: "craig@bigfishrecruitment.co.uk", status: "connected", lastError: null, lastCheckedAt: null, connectedAt: "" }, true)).toBe("Reading craig@bigfishrecruitment.co.uk every fifteen minutes; last read not yet.");
    expect(connectionLine({ mailbox: "craig@bigfishrecruitment.co.uk", status: "connected", lastError: null, lastCheckedAt: null, connectedAt: "", idle: true }, true)).toBe("Connected to craig@bigfishrecruitment.co.uk. Idle until a first email goes to a contact; from then it reads every fifteen minutes. Last read not yet.");
  });
});
