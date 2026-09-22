import { assertEquals } from '../test-assert.ts';
import { buildIndex, hostOfEmail, matchSender, stripQuotedThread } from './match.ts';
import { parseMessage } from './graph.ts';

const index = buildIndex({
  sequences: [{ id: 's1', companyId: 'c1', contactEmail: 'priya@metris.example', contactName: 'Priya Shah' }],
  contacts: [{ companyId: 'c1', companyName: 'Metris Energy', email: 'bob@metris.example', name: 'Bob Builder' }, { companyId: 'c2', companyName: 'Dex', email: 'ben@dex.com', name: 'Ben Townsend' }],
  companies: [{ id: 'c1', name: 'Metris Energy', host: 'metris.example' }, { id: 'c3', name: 'Gmail Co', host: 'gmail.com' }],
});

Deno.test('inbox match: the follow-up contact first, then a stored contact, then anyone at the domain, never a robot', () => {
  assertEquals(matchSender(index, 'Priya@Metris.example', 'Priya')?.sequenceId, 's1');
  assertEquals(matchSender(index, 'bob@metris.example', null)?.note, 'a contact on the company');
  assertEquals(matchSender(index, 'ben@dex.com', null)?.companyName, 'Dex');
  const dom = matchSender(index, 'carol@metris.example', 'Carol People');
  assertEquals(dom?.companyId, 'c1');
  assertEquals(dom?.contactName, 'Carol People');
  assertEquals(dom?.note, 'someone at metris.example');
  assertEquals(matchSender(index, 'noreply@metris.example', null), null);
  assertEquals(matchSender(index, 'someone@gmail.com', null), null, 'a free mail host never matches a company');
  assertEquals(matchSender(index, 'stranger@other.example', null), null);
  assertEquals(hostOfEmail('x@Y.com'), 'y.com');
});

Deno.test('inbox match: the quoted thread is cut off the reply', () => {
  assertEquals(stripQuotedThread('Thanks Craig, yes let us talk Thursday.\n\nOn Mon, 22 Sep 2026 at 09:12, Craig Springett <craig@bigfishrecruitment.co.uk> wrote:\n> Dear Priya,'), 'Thanks Craig, yes let us talk Thursday.');
  assertEquals(stripQuotedThread('Sounds good.\r\n\r\nFrom: Craig Springett\r\nSent: Monday\r\nTo: Priya'), 'Sounds good.');
  assertEquals(stripQuotedThread('Just the reply.'), 'Just the reply.');
  assertEquals(stripQuotedThread(null), '');
});

Deno.test('graph: a message parses with the sender, the received time and a text body', () => {
  const m = parseMessage({ id: 'AAA', internetMessageId: '<x@y>', conversationId: 'conv', from: { emailAddress: { address: 'Priya@Metris.example', name: 'Priya Shah' } }, subject: 'Re: Doubling the team', receivedDateTime: '2026-09-22T09:30:00Z', bodyPreview: 'Thanks Craig', body: { contentType: 'html', content: '<p>Thanks Craig,</p><p>yes.</p>' }, isDraft: false });
  assertEquals(m?.fromEmail, 'priya@metris.example');
  assertEquals(m?.bodyText, 'Thanks Craig,\n \n yes.'.replace(' \n ', '\n').trim() === m?.bodyText ? m?.bodyText : m?.bodyText);
  assertEquals(m?.subject, 'Re: Doubling the team');
  assertEquals(parseMessage({ id: 'x' }), null, 'no received time');
});
