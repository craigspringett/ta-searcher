import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { textFromDocx, textFromFile } from "@/lib/textFromFile";

describe("example text from a dropped file", () => {
  it("strips tags from html", () => {
    expect(textFromFile("a.html", "<p>Hello <b>Sam</b></p><p>Bye</p>")).toBe("Hello Sam\nBye");
  });
  it("keeps the body of an email file", () => {
    expect(textFromFile("a.eml", "Subject: Hi\nFrom: a@b.c\n\nDear Sam,\n\nA note.")).toBe("Dear Sam,\n\nA note.");
  });
  it("leaves plain text alone", () => {
    expect(textFromFile("a.txt", "one\r\n\r\n\r\n\r\ntwo")).toBe("one\n\ntwo");
  });
  it("reads the paragraphs of a Word file", () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Hello Sam,</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Tea &amp; </w:t></w:r><w:r><w:t>biscuits</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>next line</w:t></w:r></w:p></w:body></w:document>';
    const docx = zipSync({ "word/document.xml": strToU8(xml), "[Content_Types].xml": strToU8("<Types/>") });
    expect(textFromDocx(docx)).toBe("Hello Sam,\nTea & biscuits\nnext line");
    expect(textFromDocx(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
