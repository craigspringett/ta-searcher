// Replace globalThis.fetch for one test: a map of URL (or URL prefix) to the
// answer, and a log of what was asked for. Restored by `restore()`.
export interface StubAnswer {
  status?: number;
  body?: string | object;
  headers?: Record<string, string>;
}

export function stubFetch(answers: Record<string, StubAnswer | ((url: string, init?: RequestInit) => StubAnswer)>) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, method: init?.method || 'GET' });
    const key = Object.keys(answers).find((k) => url === k || url.startsWith(k));
    const a = key ? (typeof answers[key] === 'function' ? (answers[key] as any)(url, init) : answers[key]) : { status: 404, body: 'not stubbed' };
    const body = typeof a.body === 'string' ? a.body : a.body === undefined ? '' : JSON.stringify(a.body);
    return Promise.resolve(new Response(body, { status: a.status ?? 200, headers: a.headers ?? {} }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

export function fixture(name: string): string {
  return Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url));
}
