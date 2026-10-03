const assert = require('assert');
const { timeContext } = require('./availability-fixture');
const { createRunner } = require('./_runner');
const r = createRunner('TimeService timezone conversion');
r.test('converts business time independently of process timezone', () => {
  const t = timeContext().TimeService;
  assert.strictEqual(t.localDateTimeToInstant('2026-10-03', '09:00', 'Asia/Kolkata', 'reject').toISOString(), '2026-10-03T03:30:00.000Z');
  const p = t.formatInZone('2026-10-03T03:30:00Z', 'Asia/Kolkata');
  assert.strictEqual(p.date, '2026-10-03');
  assert.strictEqual(p.time, '09:00');
  assert.strictEqual(p.weekday, 'Saturday');
});
r.test('rejects missing spring-forward time even with disambiguation', () => {
  const t = timeContext().TimeService;
  ['reject', 'earlier', 'later'].forEach(choice => assert.throws(() =>
    t.localDateTimeToInstant('2026-03-08', '02:30', 'America/New_York', choice), /nonexistent/));
});
r.test('requires explicit earlier or later choice for fall-back time', () => {
  const t = timeContext().TimeService;
  assert.throws(() => t.localDateTimeToInstant('2026-11-01', '01:30', 'America/New_York', 'reject'), /ambiguous/);
  assert.strictEqual(t.localDateTimeToInstant('2026-11-01', '01:30', 'America/New_York', 'earlier').toISOString(), '2026-11-01T05:30:00.000Z');
  assert.strictEqual(t.localDateTimeToInstant('2026-11-01', '01:30', 'America/New_York', 'later').toISOString(), '2026-11-01T06:30:00.000Z');
});
r.test('handles half-hour DST and quarter-hour offsets', () => {
  const t = timeContext().TimeService;
  assert.strictEqual(t.localDateTimeToInstant('2026-04-05', '01:45', 'Australia/Lord_Howe', 'earlier').toISOString(), '2026-04-04T14:45:00.000Z');
  assert.strictEqual(t.localDateTimeToInstant('2026-04-05', '01:45', 'Australia/Lord_Howe', 'later').toISOString(), '2026-04-04T15:15:00.000Z');
  assert.strictEqual(t.localDateTimeToInstant('2026-10-03', '09:00', 'Asia/Kathmandu', 'reject').toISOString(), '2026-10-03T03:15:00.000Z');
});
r.test('rejects invalid dates, clocks, zones, choices and unzoned instants', () => {
  const t = timeContext().TimeService;
  [['2026-02-30', '09:00'], ['2026-1-02', '09:00'], ['2026-10-03', '24:00'], ['2026-10-03', '9:00']]
    .forEach(p => assert.throws(() => t.localDateTimeToInstant(p[0], p[1], 'UTC', 'reject'), /Invalid/));
  assert.throws(() => t.localDateTimeToInstant('2026-10-03', '09:00', 'bad/zone', 'reject'));
  assert.throws(() => t.localDateTimeToInstant('2026-10-03', '09:00', 'UTC', 'guess'), /Invalid/);
  assert.throws(() => t.formatInZone('2026-10-03T09:00:00', 'UTC'), /Invalid/);
});
process.exit(r.done() === 0 ? 0 : 1);
