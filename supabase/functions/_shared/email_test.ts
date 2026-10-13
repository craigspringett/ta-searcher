import { inlineSignatureImages } from './email.ts'
import { assertEquals } from './test-assert.ts'

Deno.test('signature images become inline attachments', () => {
  const html = '<img src="https://ta-searcher.netlify.app/email/bigfish-logo.png" alt="x"><img src="https://ta-searcher.netlify.app/email/bigfish-logo.png"><img src="https://other.example/a.png">'
  const r = inlineSignatureImages(html)
  assertEquals(r.html, '<img src="cid:bigfish-logo" alt="x"><img src="cid:bigfish-logo"><img src="https://other.example/a.png">')
  assertEquals(r.attachments, [{ filename: 'bigfish-logo.png', path: 'https://ta-searcher.netlify.app/email/bigfish-logo.png', content_id: 'bigfish-logo' }])
})
