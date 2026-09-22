import { assert, assertEquals } from '../test-assert.ts';
import { applyEntry, enrichCandidates, enrichContacts, enrichKey, enrichSummary, mailDomain, type EnrichmentEntry } from './enrich.ts';
import type { FinderReply, VerifyReply } from './hunter.ts';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const finderOk = (email: string, score = 90, status: string | null = 'valid'): FinderReply => ({ ok: true, status: 200, email, score, verificationStatus: status, position: null, linkedin: 'https://www.linkedin.com/in/alice/', error: null });
const finderNone: FinderReply = { ok: true, status: 200, email: null, score: null, verificationStatus: null, position: null, linkedin: null, error: null };
const verify = (result: VerifyReply['result'], status: string | null = null, http = 200): VerifyReply => ({ ok: true, status: http, result, verifyStatus: status, score: null, error: null });

const CH = 'https://find-and-update.company-information.service.gov.uk/company/1/officers';
const contacts = () => [
  { name: 'Alice Founder', role: 'Co-founder and CEO', email: '', confidence: 'role_only', evidence: 'Named on the team page.', source_url: 'https://x/team' },
  { name: 'Bob Builder', role: 'Director (Companies House, appointed 2024-01-01)', email: '', confidence: 'role_only', evidence: 'Listed as director.', source_url: CH },
  { name: 'Carol People', role: 'Head of People', email: 'carol@x.com', confidence: 'found', evidence: '', source_url: 'https://x/team' },
  { name: 'ACME NOMINEES LIMITED', role: 'Director (Companies House)', email: '', confidence: 'role_only', evidence: '', source_url: CH },
  { name: 'Dan', role: 'CTO', email: '', confidence: 'role_only', evidence: '', source_url: 'https://x/team' },
  { name: 'Eve Angel', role: 'Investor', email: '', confidence: 'role_only', evidence: '', source_url: 'https://x/team' },
  { name: 'Fred Gone', role: 'Director', email: '', confidence: 'role_only', evidence: '', source_url: CH, feedback: 'left' },
  { name: 'Gina Ops', role: 'COO', email: '', confidence: 'role_only', evidence: '', source_url: 'https://x/team' },
  { name: 'Hal Exec', role: 'VP Sales', email: '', confidence: 'role_only', evidence: '', source_url: 'https://x/team' },
];

Deno.test('enrich: the candidates are the name-only people with a ranked role, best three, no corporates, investors, reported or one-word names', () => {
  const c = enrichCandidates(contacts());
  assertEquals(c.map((x) => x.name), ['Alice Founder', 'Gina Ops', 'Bob Builder'], 'founder, COO, then the director; the VP (exec, rank 6) is fourth and out at three');
  assertEquals(enrichCandidates(contacts(), 5).map((x) => x.name), ['Alice Founder', 'Gina Ops', 'Bob Builder', 'Hal Exec']);
});

Deno.test('enrich: the domain comes from the website', () => {
  assertEquals(mailDomain('https://www.metrisenergy.com/about'), 'metrisenergy.com');
  assertEquals(mailDomain('legora.com'), 'legora.com');
  assertEquals(mailDomain(null), null);
  assertEquals(mailDomain('localhost'), null);
  assertEquals(enrichKey('Dr Alice Founder', 'X.com'), 'alicefounder@x.com');
});

Deno.test('enrich: the Finder wins at a good score; a guess is verified one pattern at a time; nothing is claimed as found', async () => {
  const calls: string[] = [];
  const deps = {
    finder: (domain: string, first: string, last: string) => { calls.push(`finder ${first} ${last}@${domain}`); return Promise.resolve(first === 'alice' ? finderOk('alice@x.com', 92, 'valid') : first === 'gina' ? finderOk('g.ops@x.com', 30, null) : finderNone); },
    verify: (email: string) => { calls.push(`verify ${email}`); return Promise.resolve(email === 'gina@x.com' ? verify('undeliverable', 'invalid') : email === 'gina.ops@x.com' ? verify('deliverable', 'valid') : email === 'bob@x.com' ? verify('risky', 'accept_all') : verify('unknown')); },
  };
  const r = await enrichContacts(contacts(), { domain: 'x.com', now: NOW, deps });
  assertEquals(calls, ['finder alice founder@x.com', 'finder gina ops@x.com', 'verify gina@x.com', 'verify gina.ops@x.com', 'finder bob builder@x.com', 'verify bob@x.com']);
  assertEquals(r.finderCalls, 3);
  assertEquals(r.verifyCalls, 3);
  assertEquals(r.filled, 3);
  const alice = r.contacts[0];
  assertEquals(alice.email, 'alice@x.com');
  assertEquals(alice.confidence, 'pattern_guess', 'never found: the site did not show it');
  assertEquals(alice.verification, 'deliverable');
  assertEquals(alice.email_source, 'finder');
  assertEquals(alice.linkedin, 'https://www.linkedin.com/in/alice/');
  assert(alice.evidence!.startsWith('Hunter Email Finder gave alice@x.com (score 92%, valid). Named on the team page.'), alice.evidence);
  const gina = r.contacts.find((c) => c.name === 'Gina Ops')!;
  assertEquals(gina.email, 'gina.ops@x.com', 'the 30% Finder answer is ignored; first@ was undeliverable, first.last@ deliverable');
  assertEquals(gina.verification, 'deliverable');
  assertEquals(gina.email_source, 'guess');
  const bob = r.contacts.find((c) => c.name === 'Bob Builder')!;
  assertEquals(bob.email, 'bob@x.com');
  assertEquals(bob.verification, 'risky');
  assert(bob.evidence!.includes('risky (the server accepts every address)'));
  // Untouched: the found one, the corporate, the investor, the reported, the one-word name, the fourth-ranked exec.
  assertEquals(r.contacts.find((c) => c.name === 'Carol People')!.email, 'carol@x.com');
  for (const n of ['ACME NOMINEES LIMITED', 'Dan', 'Eve Angel', 'Fred Gone', 'Hal Exec']) assertEquals(r.contacts.find((c) => c.name === n)!.email, '', n);
  assertEquals(Object.keys(r.entries).sort(), ['alicefounder@x.com', 'bobbuilder@x.com', 'ginaops@x.com']);
  assertEquals(enrichSummary(r.entries), "1 found by Hunter's Email Finder, 1 guessed and verified, 1 guessed but unverified");
});

Deno.test('enrich: the cache is reused for thirty days and force ignores it; a spent quota stops the asking; no domain asks nothing', async () => {
  let finderCalls = 0;
  const deps = { finder: () => { finderCalls++; return Promise.resolve(finderOk('alice@x.com')); }, verify: () => Promise.resolve(verify('unknown')) };
  const first = await enrichContacts(contacts().slice(0, 1), { domain: 'x.com', now: NOW, deps });
  assertEquals(finderCalls, 1);
  const again = await enrichContacts(contacts().slice(0, 1), { domain: 'x.com', now: new Date('2026-10-10T00:00:00Z'), deps, cache: first.entries });
  assertEquals(finderCalls, 1, 'from the cache');
  assertEquals(again.contacts[0].email, 'alice@x.com');
  assertEquals(again.filled, 1);
  await enrichContacts(contacts().slice(0, 1), { domain: 'x.com', now: new Date('2026-11-10T00:00:00Z'), deps, cache: first.entries });
  assertEquals(finderCalls, 2, 'stale after thirty days');
  await enrichContacts(contacts().slice(0, 1), { domain: 'x.com', now: NOW, deps, cache: first.entries, force: true });
  assertEquals(finderCalls, 3, 'force asks again');

  const spent = { finder: () => Promise.resolve({ ...finderNone, ok: false, status: 429, error: 'the monthly quota is spent' } as FinderReply), verify: () => Promise.resolve(verify('deliverable')) };
  const q = await enrichContacts(contacts(), { domain: 'x.com', now: NOW, deps: spent });
  assertEquals(q.finderCalls, 1, 'one refusal, then nobody else is asked');
  assertEquals(q.verifyCalls, 0);
  assertEquals(q.filled, 0);
  assert(q.notes.some((n) => n.includes('quota is spent')), q.notes.join('; '));

  const none = await enrichContacts(contacts(), { domain: null, now: NOW, deps });
  assertEquals(none.finderCalls, 0);
  assertEquals(none.notes, ['no domain to look up']);
});

Deno.test('enrich: an entry with nothing found changes nothing', () => {
  const e: EnrichmentEntry = { name: 'Alice Founder', domain: 'x.com', at: NOW.toISOString(), finder: null, guesses: [], outcome: 'none', email: null, verification: null, linkedin: null };
  const c = { name: 'Alice Founder', role: 'CEO', email: '', confidence: 'role_only' };
  assertEquals(applyEntry(c, e), c);
});
