// Minimal assertion helpers so tests run without network access to jsr.io.
export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(msg ?? `Values are not equal.\n  actual:   ${a}\n  expected: ${e}`);
  }
}

export function assert(cond: unknown, msg?: string): void {
  if (!cond) throw new Error(msg ?? 'Assertion failed');
}
