/** Plain text from a dropped file: HTML loses its tags, an email file keeps its body. */
export function textFromFile(name: string, raw: string): string {
  let t = raw;
  if (/\.html?$/i.test(name)) t = t.replace(/<(style|script)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  if (/\.eml$/i.test(name)) { const at = t.search(/\r?\n\r?\n/); if (at > 0) t = t.slice(at).trim(); }
  return t.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}


import { strFromU8, unzipSync } from "fflate";

const decodeXml = (t: string) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** The text of a Word (.docx) file: its paragraphs in order, line breaks kept, formatting dropped. Null when the file is not a readable .docx. */
export function textFromDocx(bytes: Uint8Array): string | null {
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
    const xml = files["word/document.xml"];
    if (!xml) return null;
    const text = strFromU8(xml)
      .replace(/<w:tab\s*\/>/g, " ")
      .replace(/<w:br\s*\/>|<w:cr\s*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "");
    return decodeXml(text).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } catch { return null; }
}
