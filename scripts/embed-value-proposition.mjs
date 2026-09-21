// Regenerates supabase/functions/_shared/copy/value-proposition.default.ts (TA Searcher)
// from value-proposition.md. Run after editing the markdown:
//   node scripts/embed-value-proposition.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'supabase', 'functions', '_shared', 'copy');
const md = fs.readFileSync(path.join(dir, 'value-proposition.md'), 'utf8');
fs.writeFileSync(path.join(dir, 'value-proposition.default.ts'),
  '// Generated from value-proposition.md by scripts/embed-value-proposition.mjs.\n// Fallback used only when the markdown file is not readable at runtime; the\n// unit test fails when this file is out of date.\nexport const VALUE_PROPOSITION_DEFAULT = ' + JSON.stringify(md) + ';\n');
console.log('value-proposition.default.ts regenerated');
