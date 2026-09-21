// In-memory stand-in for the parts of the supabase client that
// persistVacancies uses: select/upsert/update on one table with eq, in and
// not-in filters. Enough to test persistence logic without a database.
type Row = Record<string, any>;

function parseInList(s: string): string[] {
  return (s.match(/"((?:[^"\\]|\\.)*)"/g) || []).map((x) => x.slice(1, -1).replace(/\\"/g, '"'));
}

export function fakeVacanciesDb(seed: Row[]) {
  return fakeDb({ vacancies: seed });
}

export function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  let nextId = 1;
  const api = {
    rows: (name = 'vacancies') => tables[name] || [],
    from(name: string) {
      if (!tables[name]) tables[name] = [];
      const table = tables[name];
      const filters: Array<(r: Row) => boolean> = [];
      let op: { kind: 'select' } | { kind: 'update'; patch: Row } | { kind: 'upsert'; rows: Row[] } | { kind: 'delete' } = { kind: 'select' };
      let conflictCols: string[] = ['company_search_id', 'vacancy_key'];
      const builder: any = {
        select() { return builder; },
        order() { return builder; },
        eq(col: string, val: any) { filters.push((r) => r[col] === val); return builder; },
        neq(col: string, val: any) { filters.push((r) => r[col] !== val); return builder; },
        in(col: string, vals: any[]) { filters.push((r) => vals.includes(r[col])); return builder; },
        not(col: string, operator: string, val: string) {
          if (operator !== 'in') throw new Error('fake db only supports not-in');
          const list = parseInList(val);
          filters.push((r) => !list.includes(r[col]));
          return builder;
        },
        update(patch: Row) { op = { kind: 'update', patch }; return builder; },
        delete() { op = { kind: 'delete' }; return builder; },
        upsert(rows: Row[], options?: { onConflict?: string }) { op = { kind: 'upsert', rows }; conflictCols = options?.onConflict ? options.onConflict.split(',').map((c) => c.trim()) : ['company_search_id', 'vacancy_key']; return builder; },
        then(resolve: (v: any) => void) {
          const matching = () => table.filter((r) => filters.every((f) => f(r)));
          if (op.kind === 'select') return resolve({ data: matching().map((r) => ({ ...r })), error: null });
          if (op.kind === 'update') {
            const patch = op.patch;
            for (const r of matching()) Object.assign(r, patch);
            return resolve({ data: null, error: null });
          }
          if (op.kind === 'delete') {
            const gone = new Set(matching());
            for (let i = table.length - 1; i >= 0; i--) if (gone.has(table[i])) table.splice(i, 1);
            return resolve({ data: null, error: null });
          }
          for (const incoming of op.rows) {
            const hit = table.find((r) => conflictCols.every((c) => r[c] === incoming[c]));
            if (hit) Object.assign(hit, incoming);
            else table.push({ id: `new-${nextId++}`, first_seen: incoming.last_seen, ...incoming });
          }
          return resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
  return api;
}
