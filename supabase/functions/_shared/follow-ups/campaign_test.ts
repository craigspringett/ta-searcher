import { assertEquals } from 'jsr:@std/assert@1';
import { DEFAULT_CAMPAIGN_PLAN, parseCampaignRequest, planTemplateFrom } from './campaign.ts';

const S1 = '11111111-1111-1111-1111-111111111111';
const S2 = '22222222-2222-2222-2222-222222222222';
const c = (company: string, n: number) => ({ companySearchId: company, contactName: `P${n}`, contactEmail: `p${n}@x.org` });

Deno.test('parseCampaignRequest: the limits are 15 contacts and 2 per company', () => {
  assertEquals(parseCampaignRequest({ name: 'A', contacts: [c(S1, 1), c(S1, 2)] }).ok?.contacts.length, 2);
  assertEquals(parseCampaignRequest({ name: 'A', contacts: [c(S1, 1), c(S1, 2), c(S1, 3)] }).error, 'At most 2 contacts at one company.');
  const sixteen = Array.from({ length: 16 }, (_, i) => c(i % 2 ? S1 : S2, i));
  assertEquals(parseCampaignRequest({ name: 'A', contacts: sixteen }).error, 'A campaign holds at most 15 contacts.');
  assertEquals(parseCampaignRequest({ name: '', contacts: [c(S1, 1)] }).error, 'Give the campaign a name.');
  assertEquals(parseCampaignRequest({ name: 'A', contacts: [c(S1, 1), c(S2, 1)] }).error, 'p1@x.org is in the list twice.');
});

Deno.test('parseCampaignRequest: the plan starts with the day 0 email and stays in order', () => {
  assertEquals(parseCampaignRequest({ name: 'A', contacts: [c(S1, 1)] }).ok?.plan, DEFAULT_CAMPAIGN_PLAN);
  assertEquals(parseCampaignRequest({ name: 'A', contacts: [c(S1, 1)], plan: [{ kind: 'call', day: 0 }] }).error, 'The first stage is the introduction email, on day 0.');
  assertEquals(parseCampaignRequest({ name: 'A', contacts: [c(S1, 1)], plan: [{ kind: 'email', day: 0 }, { kind: 'email', day: 5 }, { kind: 'call', day: 3 }] }).error, 'Stages must be in date order.');
});

Deno.test('planTemplateFrom: first, second and last emails', () => {
  const t = planTemplateFrom(DEFAULT_CAMPAIGN_PLAN);
  assertEquals(t.filter((x) => x.kind === 'email').map((x) => x.purpose), ['first', 'second', 'last']);
  assertEquals(planTemplateFrom([{ kind: 'email', day: 0 }, { kind: 'email', day: 4 }]).map((x) => x.purpose), ['first', 'second']);
});

import { emailStageAt, stepNotes } from './campaign.ts';
Deno.test('stepNotes: the brief, what this email is about, an example and a model email', () => {
  assertEquals(stepNotes('', undefined, null), null);
  const n = stepNotes('a Head of Talent for the Series A', { kind: 'email', day: 4, note: 'the first hire in the team', example: 'Hi there, a quick note.' }, { subject: 'S', body: 'B' })!;
  assertEquals(n.includes('The campaign is about: a Head of Talent for the Series A'), true);
  assertEquals(n.includes('This email should be about: the first hire in the team'), true);
  assertEquals(n.includes('Hi there, a quick note.'), true);
  assertEquals(n.includes('Subject: S'), true);
  assertEquals((stepNotes('x'.repeat(5000), undefined, null) || '').length <= 3900, true);
});

Deno.test('parseCampaignRequest keeps what each email is about and the write-alike choice', () => {
  const r = parseCampaignRequest({ name: 'A', contacts: [c(S1, 1)], writeAlike: true, plan: [{ kind: 'email', day: 0, note: 'intro', example: 'Hello' }, { kind: 'call', day: 2, note: 'ignored' }, { kind: 'email', day: 4 }] }).ok!;
  assertEquals(r.writeAlike, true);
  assertEquals(r.plan[0].note, 'intro');
  assertEquals(r.plan[1].note, undefined);
  assertEquals(emailStageAt(r.plan, 1)?.day, 4);
});

Deno.test('stepNotes: the campaign sits on top of the usual voice and rules', () => {
  const n = stepNotes('the Series A and a first Head of Talent', undefined, null)!;
  assertEquals(n.includes('usual voice and rules'), true);
});

import { campaignHoldsEmail, emailIsClean } from './campaign.ts';
Deno.test('an unapproved campaign email is held, an approved one goes even if flagged', () => {
  assertEquals(campaignHoldsEmail('c1', null), true);
  assertEquals(campaignHoldsEmail('c1', '2026-11-18T10:00:00Z'), false);
  assertEquals(campaignHoldsEmail(null, null), false); // an ordinary follow-up is not held here
  assertEquals(emailIsClean(['body 144 words (want 90 to 140)'], null, null), false);
  assertEquals(emailIsClean(['body 144 words (want 90 to 140)'], null, '2026-11-18T10:00:00Z'), true);
  assertEquals(emailIsClean(['x'], '2026-11-18T10:00:00Z', null), true);
  assertEquals(emailIsClean([], null, null), true);
});
