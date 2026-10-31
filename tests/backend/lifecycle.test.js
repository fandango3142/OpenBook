const assert = require('assert');
const { makeCtx, cmd } = require('./booking-service.test');
const { createRunner } = require('./_runner');
const r = require.main === module ? createRunner('Managed booking lifecycle') : { test: function () {} };

function makeBooking(ctx, extra) {
  return ctx.BookingService.create(cmd(extra || {}), 'PUBLIC');
}

r.test('a management token returns only its own booking and invalid tokens fail closed', () => {
  const ctx = makeCtx();
  const first = makeBooking(ctx, { email: 'first@example.com' });
  const second = makeBooking(ctx, { email: 'second@example.com', start_at: new Date(new Date(cmd().start_at).getTime() + 3600000).toISOString() });
  const defaultActions = ctx.BookingService.getManaged(first.manage_token).actions;
  assert.strictEqual(defaultActions.can_request_cancellation, false);
  assert.strictEqual(defaultActions.can_request_reschedule, false);
  assert.throws(() => ctx.BookingService.requestReschedule(first.manage_token, '2026-11-03T03:30:00.000Z'),
    e => e.domainCode === 'INVALID_STATE');
  ctx.SheetStore.setSetting('customer_cancellation_enabled', 'true');
  ctx.SheetStore.setSetting('customer_rescheduling_enabled', 'true');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.BookingService.getManaged(first.manage_token))), JSON.parse(JSON.stringify({
    booking: ctx.BookingService.publicBooking(ctx.BookingStore.getById(first.booking.booking_id)),
    actions: { can_request_cancellation: true, can_request_reschedule: true },
  })));
  assert.throws(() => ctx.BookingService.getManaged('not-a-token'), e => e.domainCode === 'INVALID_TOKEN');
  assert.notStrictEqual(first.booking.booking_id, second.booking.booking_id);
});

r.test('repeated cancellation requests append one event, send one email, and retain capacity', () => {
  const ctx = makeCtx();
  ctx.SheetStore.setSetting('customer_cancellation_enabled', 'true');
  let notifications = 0;
  ctx.EmailService.sendCancellationRequested = () => { notifications++; ctx._operationOrder.push('request-email'); };
  const created = makeBooking(ctx);
  const first = ctx.BookingService.requestCancellation(created.manage_token);
  const second = ctx.BookingService.requestCancellation(created.manage_token);
  assert.strictEqual(first.booking.status, 'CANCELLATION_REQUESTED');
  assert.strictEqual(second.booking.status, 'CANCELLATION_REQUESTED');
  assert.strictEqual(ctx.SheetStore.readAll('BookingEvents').filter(e => e.event_type === 'CANCELLATION_REQUESTED').length, 1);
  assert.strictEqual(notifications, 1);
  assert.strictEqual(ctx.BookingStore.listActive(created.booking.start_at, created.booking.end_at, 'SRV_demo').length, 1);
  const emailIndex = ctx._operationOrder.indexOf('request-email');
  assert.deepStrictEqual(ctx._operationOrder.slice(emailIndex - 2, emailIndex + 1), ['flush', 'unlock', 'request-email']);
});

r.test('failed lifecycle event append restores the original booking state', () => {
  const ctx = makeCtx();
  const created = makeBooking(ctx);
  ctx._failAppendFor.push('BookingEvents');
  assert.throws(() => ctx.BookingService.requestCancellation(created.manage_token));
  assert.strictEqual(ctx.BookingStore.getById(created.booking.booking_id).status, 'CONFIRMED');
});

r.test('customer rescheduling is rejected when the business has disabled it', () => {
  const ctx = makeCtx();
  ctx.SheetStore.setSetting('customer_rescheduling_enabled', 'false');
  const created = makeBooking(ctx);
  assert.throws(() => ctx.BookingService.requestReschedule(created.manage_token, '2026-10-05T03:30:00.000Z'),
    e => e.domainCode === 'INVALID_STATE');
  assert.strictEqual(ctx.BookingStore.getById(created.booking.booking_id).status, 'CONFIRMED');
});

r.test('reschedule request metadata is allowlisted and original interval remains reserved', () => {
  const ctx = makeCtx();
  ctx.SheetStore.setSetting('customer_rescheduling_enabled', 'true');
  const created = makeBooking(ctx);
  const requestedStart = new Date(new Date(created.booking.start_at).getTime() + 3600000).toISOString();
  const result = ctx.BookingService.requestReschedule(created.manage_token, requestedStart);
  const stored = ctx.BookingStore.getById(created.booking.booking_id);
  const event = ctx.SheetStore.readAll('BookingEvents').find(e => e.event_type === 'RESCHEDULE_REQUESTED');
  assert.strictEqual(result.booking.status, 'RESCHEDULE_REQUESTED');
  assert.strictEqual(stored.start_at, created.booking.start_at);
  assert.deepStrictEqual(JSON.parse(event.metadata_json), { requested_start_at: requestedStart });
  assert.strictEqual(ctx.BookingStore.listActive(created.booking.start_at, created.booking.end_at, 'SRV_demo').length, 1);
});

r.test('cancellation cannot report success while a reschedule request is pending', () => {
  const ctx = makeCtx();
  ctx.SheetStore.setSetting('customer_rescheduling_enabled', 'true');
  ctx.SheetStore.setSetting('customer_cancellation_enabled', 'true');
  const created = makeBooking(ctx);
  const requestedStart = new Date(new Date(created.booking.start_at).getTime() + 3600000).toISOString();
  ctx.BookingService.requestReschedule(created.manage_token, requestedStart);
  assert.throws(() => ctx.BookingService.requestCancellation(created.manage_token),
    e => e.domainCode === 'INVALID_STATE');
  assert.strictEqual(ctx.BookingStore.getById(created.booking.booking_id).status, 'RESCHEDULE_REQUESTED');
  assert.strictEqual(ctx.SheetStore.readAll('BookingEvents').filter(e => e.event_type === 'CANCELLATION_REQUESTED').length, 0);
});

r.test('public management actions are routed through POST', () => {
  const ctx = makeCtx();
  const created = makeBooking(ctx);
  const { parseResponse } = require('./gas-harness');
  const read = parseResponse(ctx.routePublic({ action: 'getManagedBooking', token: created.manage_token }));
  assert.strictEqual(read.success, true);
  assert.strictEqual(read.booking.booking_id, created.booking.booking_id);
  assert.strictEqual(parseResponse(ctx.doGet({ parameter: { action: 'getManagedBooking', token: created.manage_token } })).error,
    'VALIDATION_ERROR');
});

if (require.main === module) process.exit(r.done() === 0 ? 0 : 1);
