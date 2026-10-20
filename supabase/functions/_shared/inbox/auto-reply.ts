// Is this message an automatic answer (out of office, on leave) and not a
// person replying? Craig, 20 October 2026: an out-of-office must not stop a
// follow-up run, because nobody has replied. Subject and opening words only;
// the quoted thread is not read. A message saying the person has left the
// company is NOT treated as an auto-reply here: that contact is gone and the
// run should stop.

const SUBJECT = /^\s*(?:(?:re|fw|fwd)\s*:\s*)?(?:automatic reply|auto[- ]?reply|autoreply|auto[- ]?response|out[- ]of[- ]office|ooo\b|away from (?:the )?office|vacation reply|holiday reply|abwesenheit|r[eé]ponse automatique)/i;

const LEFT_COMPANY = /\b(?:no longer (?:works?|working|with|at|employed|part of)|has left (?:the company|\w+)|left (?:the company|the business)|is no longer)\b/i;

const BODY = /\b(?:out of (?:the )?office|i(?:'m| am) (?:currently )?(?:away|out|on (?:annual|maternity|paternity|parental|sick|study|special|adoption) leave|on leave|on holiday|on vacation|travelling|traveling|off)|i(?:'m| am) ooo|\booo\b|(?:on|until|returning|back on|will be back|will return)\b[^.\n]{0,40}\b(?:leave|holiday|vacation)\b|limited access to (?:my )?email|this is an automated (?:reply|response|message)|automatic reply|auto[- ]?reply|will respond (?:to your email )?(?:when|on|after) (?:i|my) return)/i;

export interface AutoReplyVerdict { auto: boolean; reason: string | null }

/** Looks at the subject and the first 600 characters of the reply (quoted thread already removed). */
export function autoReplyVerdict(subject: string | null | undefined, text: string | null | undefined): AutoReplyVerdict {
  const head = (text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (head && LEFT_COMPANY.test(head)) return { auto: false, reason: null };
  if (SUBJECT.test(subject || '')) return { auto: true, reason: 'the subject says it is an automatic reply' };
  if (head && BODY.test(head)) return { auto: true, reason: 'the message is an out-of-office notice' };
  return { auto: false, reason: null };
}
