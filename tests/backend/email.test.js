const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { createRunner } = require('./_runner');
const r = createRunner('Privacy-safe lifecycle email');

function makeEmailService() {
  const sent = [];
  const settings = { business_timezone: 'Asia/Kolkata' };
  const ctx = vm.createContext({
    Config: { get: key => ({ BUSINESS_NAME: 'OpenBook Demo', OWNER_NAME: 'OpenBook Demo', GITHUB_PAGES_URL: 'https://example.test' })[key] || '' },
    SheetStore: { getSetting: key => settings[key] || '' },
    MailApp: { sendEmail: message => sent.push(message) },
    Logger: { log: () => {} },
    Utilities: { formatDate: (date, zone, pattern) => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(date).map(p => [p.type, p.value]));
      return pattern === 'yyyy-MM-dd' ? `${parts.year}-${parts.month}-${parts.day}` : `${parts.hour}:${parts.minute}`;
    } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'Time.gs'), 'utf8'), ctx, { filename: 'Time.gs' });
  const file = path.join(__dirname, '..', '..', 'backend', 'Email.gs');
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: 'Email.gs' });
  return { service: ctx.EmailService, sent };
}

function booking(extra = {}) {
  return Object.assign({ booking_id: 'BKG_123', service_name_snapshot: 'Consultation',
    customer_name_snapshot: 'Sam Student', customer_email_snapshot: 'sam@example.test',
    start_at: '2026-11-02T03:30:00.000Z', end_at: '2026-11-02T04:00:00.000Z',
    purpose: 'private purpose', notes: 'private notes', calendar_event_id: 'secret-calendar-id',
    manage_token_hash: 'secret-hash' }, extra);
}

r.test('confirmation safely escapes HTML and puts plaintext token only in the management URL', () => {
  const { service, sent } = makeEmailService();
  service.sendConfirmation(booking({ customer_name_snapshot: "O'Neil <img onerror=\"x&y\">" }), 'raw-token');
  assert.strictEqual(sent.length, 1);
  const html = sent[0].htmlBody;
  assert.ok(html.includes('O&#39;Neil &lt;img onerror=&quot;x&amp;y&quot;&gt;'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('https://example.test/manage.html?token=raw-token'));
  assert.strictEqual((sent[0].body.match(/raw-token/g) || []).length, 1);
  assert.ok(!JSON.stringify(sent[0]).includes('secret-hash'));
});

r.test('fixed templates omit arbitrary private fields and use business-local time', () => {
  const { service, sent } = makeEmailService();
  const b = booking();
  service.sendConfirmation(b, 'token-1');
  service.sendCancellationRequested(b);
  service.sendCancellationApproved(b);
  service.sendCancellationRejected(b);
  service.sendRescheduled(b, { start_at: '2026-11-01T03:30:00.000Z', end_at: '2026-11-01T04:00:00.000Z' });
  assert.strictEqual(sent.length, 5);
  const all = sent.map(m => `${m.subject}\n${m.body}\n${m.htmlBody}`).join('\n');
  for (const secret of ['private purpose', 'private notes', 'secret-calendar-id', 'secret-hash']) assert.ok(!all.includes(secret));
  assert.ok(all.includes('09:00'));
  assert.ok(!sent.slice(1).some(m => JSON.stringify(m).includes('token-1')));
});

if (require.main === module) process.exit(r.done() === 0 ? 0 : 1);
