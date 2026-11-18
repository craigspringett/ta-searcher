import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { textFromDocx, textFromFile } from "@/lib/textFromFile";

const TEXT_FILE = /\.(txt|md|eml|html?|csv)$/i;
const WORD_FILE = /\.docx$/i;

interface Props { id: string; value: string; onChange: (v: string) => void; maxLength: number; placeholder?: string; rows?: number }

/** A text box that takes pasted text, text dragged in from another window, or a dropped .txt, .md, .eml or .html file (Craig, 18 November 2026). */
export function ExampleBox({ id, value, onChange, maxLength, placeholder, rows = 4 }: Props) {
  const [over, setOver] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const take = async (files: FileList | null): Promise<boolean> => {
    const f = files && files[0];
    if (!f) return false;
    let text: string;
    if (WORD_FILE.test(f.name)) {
      const read = textFromDocx(new Uint8Array(await f.arrayBuffer()));
      if (!read) { setNote("That Word file could not be read. Paste the text in instead."); return true; }
      text = read;
    } else if (TEXT_FILE.test(f.name)) {
      text = textFromFile(f.name, await f.text());
    } else {
      setNote("That file type cannot be read here. Use a Word (.docx), .txt, .eml or .html file, or paste the text in.");
      return true;
    }
    if (!text) { setNote(`${f.name} has no text in it.`); return true; }
    onChange((value ? `${value}\n\n` : "") + text.slice(0, maxLength));
    setNote(`Added the text of ${f.name}.`);
    return true;
  };
  return (
    <div>
      <Textarea
        id={id} value={value} rows={rows} maxLength={maxLength} placeholder={placeholder}
        className={over ? "ring-2 ring-primary" : undefined}
        onChange={(e) => onChange(e.target.value)}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { setOver(false); if (e.dataTransfer.files && e.dataTransfer.files.length > 0) { e.preventDefault(); void take(e.dataTransfer.files); } }}
      />
      {note && <p className="mt-0.5 text-xs text-muted-foreground" role="status">{note}</p>}
    </div>
  );
}
