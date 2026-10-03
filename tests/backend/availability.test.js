const assert = require('assert');
const { make, now, query, check, booking, event } = require('./availability-fixture');
const { createRunner } = require('./_runner');
const r = createRunner('Sheet-backed capacity availability');
function exception(ctx, extra) {
  ctx.SheetStore.append('AvailabilityExceptions', Object.assign({ exception_id: 'EX_1', service_id: '',
    start_at: '2026-10-05T04:30:00Z', end_at: '2026-10-05T05:00:00Z', reason: 'private', active: true }, extra));
}
r.test('combines two windows, global exception, full-capacity external conflict and quantities', () => {
  const ctx = make({ calendarEvents: { external: [event('busy', '2026-10-05T09:30:00Z', '2026-10-05T10:00:00Z')] } });
  exception(ctx);
  booking(ctx, { quantity: 1 });
  booking(ctx, { booking_id: 'BKG_2', quantity: 1 });
  const slots = JSON.parse(JSON.stringify(ctx.AvailabilityService.listSlots(query)));
  assert.deepStrictEqual(slots.map(s => s.start_at), ['03:30', '04:00', '05:00', '05:30', '06:00', '08:30', '09:00', '10:00', '10:30', '11:00'].map(t => '2026-10-05T' + t + ':00.000Z'));
  assert.strictEqual(slots[0].remaining_capacity, 1);
  assert.strictEqual(slots[1].remaining_capacity, 3);
  assert.strictEqual(check(ctx, '2026-10-05T03:30:00Z', { quantity: 2 }).code, 'INSUFFICIENT_CAPACITY');
  assert.strictEqual(check(ctx, '2026-10-05T04:00:00Z', { quantity: 2 }).remaining_capacity, 1);
  assert.ok(!JSON.stringify(slots).includes('private'));
});
r.test('buffers must fit a single window and touch conflicts with half-open boundaries', () => {
  const ctx = make({ service: { buffer_before_minutes: 15, buffer_after_minutes: 15 } });
  assert.strictEqual(check(ctx, '2026-10-05T03:30:00Z').ok, false);
  assert.strictEqual(check(ctx, '2026-10-05T03:45:00Z').ok, true);
  assert.strictEqual(check(ctx, '2026-10-05T06:00:00Z').ok, false);
  exception(ctx);
  assert.strictEqual(check(ctx, '2026-10-05T03:45:00Z').ok, true);
  assert.strictEqual(check(ctx, '2026-10-05T04:00:00Z').ok, false);
  assert.strictEqual(check(ctx, '2026-10-05T05:00:00Z').ok, false);
  assert.strictEqual(check(ctx, '2026-10-05T05:15:00Z').ok, true);
});
r.test('service-specific, inactive and other-service exceptions are filtered correctly', () => {
  const ctx = make();
  exception(ctx, { service_id: 'OTHER' });
  exception(ctx, { exception_id: 'EX_2', service_id: 'SRV_demo', active: false });
  assert.strictEqual(check(ctx, '2026-10-05T04:30:00Z').ok, true);
  exception(ctx, { exception_id: 'EX_3', service_id: 'SRV_demo' });
  assert.strictEqual(check(ctx, '2026-10-05T04:30:00Z').code, 'SLOT_UNAVAILABLE');
});
r.test('malformed exception activation fails closed instead of opening its blocked interval', () => {
  ['tru', 'true ', ' false', 'true\n', 'false\r\n', '\ttrue', ' ', '', undefined, null, 1, 0, 'yes', '1'].forEach(active => {
    const ctx = make();
    exception(ctx, { active });
    assert.throws(() => check(ctx, '2026-10-05T04:30:00Z'), /Invalid active/, 'active=' + String(active));
    assert.throws(() => ctx.AvailabilityService.listSlots(query), /Invalid active/);
  });
});
r.test('malformed window activation fails closed instead of silently dropping configuration', () => {
  ['tru', 'true ', ' false', 'true\n', 'false\r\n', '\ttrue', ' ', '', undefined, null, 1, 0, 'yes', '1'].forEach(active => {
    const ctx = make();
    ctx.SheetStore.updateById('Availability', 'availability_id', 'AV_0', { active });
    assert.throws(() => ctx.AvailabilityStore.listWindows('SRV_demo'), /Invalid active/, 'active=' + String(active));
    assert.throws(() => check(ctx, '2026-10-05T03:30:00Z'), /Invalid active/);
  });
});
r.test('activation accepts booleans and case-normalized true/false strings only', () => {
  [[true, true], ['true', true], ['TRUE', true], ['TrUe', true],
    [false, false], ['false', false], ['FALSE', false], ['FaLsE', false]].forEach(([active, enabled]) => {
    const ctx = make();
    exception(ctx, { active });
    assert.strictEqual(check(ctx, '2026-10-05T04:30:00Z').ok, !enabled);
    ctx.SheetStore.updateById('Availability', 'availability_id', 'AV_0', { active });
    assert.strictEqual(ctx.AvailabilityStore.listWindows('SRV_demo').length, enabled ? 2 : 1);
  });
});
r.test('entirely blank trailing Sheet rows are not activation records', () => {
  const ctx = make();
  ['Availability', 'AvailabilityExceptions'].forEach(name => {
    ctx._sheets[name].rows.push(ctx._sheets[name].rows[0].map(() => ''));
    ctx._sheets[name].rows.push(ctx._sheets[name].rows[0].map(() => null));
  });
  assert.strictEqual(ctx.AvailabilityStore.listWindows('SRV_demo').length, 2);
  assert.strictEqual(check(ctx, '2026-10-05T04:30:00Z').ok, true);
});
r.test('all active scheduled states reserve quantity; terminal and other-service rows do not', () => {
  ['CONFIRMED', 'CANCELLATION_REQUESTED', 'RESCHEDULE_REQUESTED'].forEach(status => {
    const ctx = make(); booking(ctx, { status, quantity: 3 });
    assert.strictEqual(check(ctx, '2026-10-05T03:30:00Z').code, 'INSUFFICIENT_CAPACITY');
    assert.strictEqual(check(ctx, '2026-10-05T03:30:00Z', { exclude_booking_id: 'BKG_1' }).ok, true);
    assert.strictEqual(check(ctx, '2026-10-05T04:00:00Z').ok, true);
  });
  const ctx = make();
  ['CANCELLED', 'COMPLETED', 'NO_SHOW'].forEach(status => booking(ctx, { status, quantity: 3 }));
  booking(ctx, { service_id: 'OTHER', quantity: 3 });
  assert.strictEqual(check(ctx, '2026-10-05T03:30:00Z').remaining_capacity, 2);
});
r.test('capacity uses peak concurrent quantity rather than summing disjoint reservations', () => {
  const ctx = make({ service: { duration_minutes: 60 } });
  booking(ctx, { quantity: 2 });
  booking(ctx, { booking_id: 'BKG_2', start_at: '2026-10-05T04:00:00Z', end_at: '2026-10-05T04:30:00Z', quantity: 2 });
  assert.strictEqual(check(ctx, '2026-10-05T03:30:00Z').remaining_capacity, 0);
});
r.test('buffers expand both existing and proposed occupied intervals for capacity', () => {
  const ctx = make({ service: { buffer_before_minutes: 10, buffer_after_minutes: 10 } });
  booking(ctx, { start_at: '2026-10-05T04:00:00Z', end_at: '2026-10-05T04:30:00Z', quantity: 3 });
  assert.strictEqual(check(ctx, '2026-10-05T04:40:00Z').code, 'INSUFFICIENT_CAPACITY');
  assert.strictEqual(check(ctx, '2026-10-05T04:50:00Z').ok, true);
});
r.test('zero notice and inclusive notice / start booking-window boundaries work', () => {
  const ctx = make({ settings: { minimum_notice_hours: 1, booking_window_days: 1 } });
  const clock = new Date('2026-10-05T02:30:00Z');
  assert.strictEqual(check(ctx, '2026-10-05T03:30:00Z', { now: clock }).ok, true);
  assert.strictEqual(check(ctx, '2026-10-05T03:30:00Z', { now: new Date(clock.getTime() + 1) }).code, 'MINIMUM_NOTICE');
  assert.strictEqual(check(ctx, '2026-10-05T03:30:00Z', { now: new Date('2026-10-04T03:30:00Z') }).ok, true);
  assert.strictEqual(check(ctx, '2026-10-05T03:30:00Z', { now: new Date('2026-10-04T03:29:59Z') }).code, 'BOOKING_WINDOW');
  ctx.SheetStore.setSetting('minimum_notice_hours', 0);
  assert.strictEqual(check(ctx, '2026-10-05T03:30:00Z', { now: new Date('2026-10-05T03:30:00Z') }).ok, true);
});
r.test('slot grid is local, deduplicated and quantity-filtered without shifting to query start', () => {
  const ctx = make({ windows: [['Monday', '09:00', '10:00'], ['Monday', '09:00', '10:00']] });
  booking(ctx, { quantity: 2 });
  const slots = ctx.AvailabilityService.listSlots(Object.assign({}, query, { quantity: 2, start_at: '2026-10-05T03:40:00Z' }));
  assert.strictEqual(slots.length, 1);
  assert.strictEqual(slots[0].start_at, '2026-10-05T04:00:00.000Z');
});
r.test('spring-forward skips nonexistent grid times; fall-back requires explicit branch for listing', () => {
  const opts = { settings: { business_timezone: 'America/New_York', booking_window_days: 365 }, windows: [['Sunday', '00:00', '04:00']] };
  const ctx = make(opts);
  const spring = ctx.AvailabilityService.listSlots({ service_id: 'SRV_demo', start_at: '2026-03-08T05:00:00Z', end_at: '2026-03-08T08:00:00Z', now: new Date('2026-03-01T00:00:00Z') });
  assert.deepStrictEqual(Array.from(spring, s => s.start_at), ['05:00', '05:30', '06:00', '06:30', '07:00', '07:30'].map(t => '2026-03-08T' + t + ':00.000Z'));
  const fallQuery = { service_id: 'SRV_demo', start_at: '2026-11-01T04:00:00Z', end_at: '2026-11-01T09:00:00Z', now };
  const earlier = ctx.AvailabilityService.listSlots(Object.assign({}, fallQuery, { disambiguation: 'earlier' }));
  const later = ctx.AvailabilityService.listSlots(Object.assign({}, fallQuery, { disambiguation: 'later' }));
  assert.ok(earlier.some(s => s.start_at === '2026-11-01T05:30:00.000Z'));
  assert.ok(later.some(s => s.start_at === '2026-11-01T06:30:00.000Z'));
  const normal = ctx.AvailabilityService.listSlots(fallQuery);
  assert.ok(!normal.some(s => /T0[56]:/.test(s.start_at)));
  assert.strictEqual(check(ctx, '2026-11-01T06:30:00Z').ok, true);
});
r.test('fall-back does not bridge a repeated clock segment outside the recurring window', () => {
  const ctx = make({ settings: { business_timezone: 'America/New_York' }, windows: [['Sunday', '01:30', '02:30']] });
  assert.strictEqual(check(ctx, '2026-11-01T06:00:00Z').ok, false, 'second 01:00 is before the local opening');
  assert.strictEqual(check(ctx, '2026-11-01T05:45:00Z').ok, false, 'first 01:45 crosses closed second 01:00');
  assert.strictEqual(check(ctx, '2026-11-01T05:30:00Z').ok, true);
  assert.strictEqual(check(ctx, '2026-11-01T06:30:00Z').ok, true);
});
r.test('invalid numeric settings cannot silently become zero notice or an empty slot grid', () => {
  ['minimum_notice_hours', 'booking_window_days', 'slot_interval_minutes'].forEach(key => {
    [true, '   ', 'oops', -1].forEach(value => {
      const ctx = make({ settings: { [key]: value } });
      assert.throws(() => check(ctx, '2026-10-05T03:30:00Z'), /Invalid/);
    });
  });
});
r.test('validates service data, windows, exceptions and request inputs', () => {
  const ctx = make();
  [0, -1, 1.5, 'two', true].forEach(quantity => assert.strictEqual(check(ctx, '2026-10-05T03:30:00Z', { quantity }).code, 'VALIDATION_ERROR'));
  assert.strictEqual(check(ctx, '2026-10-05T09:00:00').code, 'VALIDATION_ERROR');
  assert.strictEqual(check(ctx, '2026-10-05T03:30:00Z', { service_id: 'missing' }).code, 'SERVICE_INACTIVE');
  ctx.SheetStore.updateById('Services', 'service_id', 'SRV_demo', { active: false });
  assert.strictEqual(ctx.ServiceStore.listActive().length, 0);
  assert.strictEqual(check(ctx, '2026-10-05T03:30:00Z').code, 'SERVICE_INACTIVE');
  [0, -1, 1.5].forEach(duration => assert.throws(() => make({ service: { duration_minutes: duration } }).ServiceStore.listActive(), /Invalid/));
  [['Monday', '22:00', '02:00'], ['Moonday', '09:00', '10:00'], ['Monday', '9:00', '10:00']].forEach(w => assert.throws(() => make({ windows: [w] }).AvailabilityStore.listWindows('SRV_demo'), /Invalid/));
  exception(ctx, { end_at: 'invalid' });
  assert.throws(() => ctx.AvailabilityStore.listExceptions('SRV_demo', query.start_at, query.end_at), /Invalid/);
});
r.test('booking calendar linked active events never consume all capacity', () => {
  const ctx = make({ settings: { conflict_calendar_ids: '["bookings"]' }, calendarEvents: {
    bookings: [event('linked', '2026-10-05T03:30:00Z', '2026-10-05T04:00:00Z')] } });
  booking(ctx, { calendar_event_id: 'linked@google.com' });
  assert.strictEqual(check(ctx, '2026-10-05T03:30:00Z', { quantity: 2 }).remaining_capacity, 0);
  assert.strictEqual(check(ctx, '2026-10-05T03:30:00Z', { exclude_booking_id: 'BKG_1', quantity: 3 }).ok, true);
});
process.exit(r.done() === 0 ? 0 : 1);
