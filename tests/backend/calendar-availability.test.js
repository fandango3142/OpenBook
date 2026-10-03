const assert = require('assert');
const { make, query, event } = require('./availability-fixture');
const { createRunner } = require('./_runner');
const r = createRunner('CalendarGateway external conflicts');
const start = '2026-10-05T03:30:00Z', end = '2026-10-05T04:00:00Z';
function conflicts(ctx, linked = []) { return ctx.CalendarGateway.listConflicts(query.start_at, query.end_at, linked); }
r.test('only configured calendars block and transparency/cancellation/declines do not', () => {
  const ctx = make({ calendarEvents: { bookings: [event('b', start, end)], external: [
    event('busy', start, end), event('free', start, end, { transparency: 'transparent' }),
    event('cancelled', start, end, { status: 'cancelled' }),
    event('declined', start, end, { attendees: [{ self: true, responseStatus: 'declined' }] }),
    event('outside', '2026-10-07T00:00:00Z', '2026-10-07T01:00:00Z'),
  ] } });
  assert.strictEqual(conflicts(ctx).length, 1);
  assert.strictEqual(conflicts(ctx)[0].start_at, '2026-10-05T03:30:00.000Z');
});
r.test('ignores linked IDs and iCalUIDs only on the booking calendar', () => {
  const ctx = make({ settings: { conflict_calendar_ids: '["bookings","external"]' }, calendarEvents: {
    bookings: [event('linked', start, end), event('api-id', start, end, { iCalUID: 'ical@google.com' }), event('unlinked', start, end)],
    external: [event('linked', start, end)],
  } });
  assert.strictEqual(conflicts(ctx, ['linked@google.com', 'ical@google.com']).length, 2);
});
r.test('busy all-day and multi-day events block, respecting the source Calendar timezone', () => {
  const ctx = make();
  ctx.Calendar.Events.list = () => ({ timeZone: 'America/New_York', items: [
    { id: 'day', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } },
    event('long', '2026-10-04T00:00:00Z', '2026-10-07T00:00:00Z'),
  ] });
  const result = conflicts(ctx);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].start_at, '2026-10-05T04:00:00.000Z');
  assert.strictEqual(result[0].end_at, '2026-10-06T04:00:00.000Z');
});
r.test('paginates, deduplicates configured calendars and fails closed on API errors', () => {
  const ctx = make({ settings: { conflict_calendar_ids: '["external","external"]' } });
  let calls = 0;
  ctx.Calendar.Events.list = (id, params) => {
    calls++;
    assert.strictEqual(id, 'external');
    assert.strictEqual(params.singleEvents, true);
    assert.strictEqual(params.timeMin, '2026-10-05T00:00:00.000Z');
    return params.pageToken ? { items: [event('b', start, end)] } : { items: [event('a', start, end)], nextPageToken: 'page2' };
  };
  assert.strictEqual(conflicts(ctx).length, 2);
  assert.strictEqual(calls, 2);
  ctx.Calendar.Events.list = () => { throw new Error('API unavailable'); };
  assert.throws(() => conflicts(ctx), /API unavailable/);
});
r.test('malformed conflict configuration and busy intervals cannot silently open capacity', () => {
  const ctx = make({ settings: { conflict_calendar_ids: '{invalid' } });
  assert.throws(() => conflicts(ctx), /Invalid/);
  ctx.SheetStore.setSetting('conflict_calendar_ids', '["external"]');
  ctx.Calendar.Events.list = () => ({ items: [event('bad', 'bad', end)] });
  assert.throws(() => conflicts(ctx), /Invalid/);
});
process.exit(r.done() === 0 ? 0 : 1);
