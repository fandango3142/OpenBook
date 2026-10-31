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

r.test('business rescheduling changes the interval in place without changing durable identity', () => {
  const ctx = makeCtx();
  ctx.SheetStore.updateById('Services', 'service_id', 'SRV_demo', { capacity: 1 });
  const created = makeBooking(ctx);
  const before = ctx.BookingStore.getById(created.booking.booking_id);
  const eventBefore = ctx._createdEvents[0];
  const nextStart = new Date(new Date(before.start_at).getTime() + 3600000).toISOString();
  const after = ctx.BookingService.reschedule(before.booking_id, { start_at: nextStart }, 'owner@example.com');
  const stored = ctx.BookingStore.getById(before.booking_id);
  assert.strictEqual(after.booking_id, before.booking_id);
  assert.strictEqual(stored.booking_id, before.booking_id);
  assert.strictEqual(stored.manage_token_hash, before.manage_token_hash);
  assert.strictEqual(stored.status, 'CONFIRMED');
  assert.strictEqual(stored.start_at, nextStart);
  assert.strictEqual(ctx._sentEmails.slice(-1)[0].type, 'reschedule');
  assert.strictEqual(ctx._sentEmails.slice(-1)[0].previous.start_at, before.start_at);
  assert.deepStrictEqual(ctx._operationOrder.slice(-3), ['flush', 'unlock', 'email']);
  assert.strictEqual(eventBefore._deleted, false);
  assert.strictEqual(eventBefore.start.toISOString(), nextStart);
  assert.deepStrictEqual(ctx.SheetStore.readAll('BookingEvents').slice(-1).map(e => e.event_type), ['BOOKING_RESCHEDULED']);
});

r.test('a failed booking write restores the Calendar interval after the Calendar move', () => {
  const ctx = makeCtx();
  const created = makeBooking(ctx);
  const before = ctx.BookingStore.getById(created.booking.booking_id);
  const event = ctx._createdEvents[0];
  ctx._failUpdateFor.push('Bookings');
  assert.throws(() => ctx.BookingService.reschedule(before.booking_id,
    { start_at: new Date(new Date(before.start_at).getTime() + 3600000).toISOString() }, 'owner@example.com'));
  assert.strictEqual(ctx.BookingStore.getById(before.booking_id).start_at, before.start_at);
  assert.strictEqual(event.start.toISOString(), before.start_at);
  assert.strictEqual(event.end.toISOString(), before.end_at);
  assert.strictEqual(event._deleted, false);
});

r.test('a partially applied Sheet interval update restores the entire original booking', () => {
  const ctx = makeCtx();
  const created = makeBooking(ctx);
  const before = ctx.BookingStore.getById(created.booking.booking_id);
  const event = ctx._createdEvents[0];
  ctx._failUpdateAfter.Bookings = 3;
  assert.throws(() => ctx.BookingService.reschedule(before.booking_id,
    { start_at: new Date(new Date(before.start_at).getTime() + 3600000).toISOString() }, 'owner@example.com'));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.BookingStore.getById(before.booking_id))), JSON.parse(JSON.stringify(before)));
  assert.strictEqual(event.start.toISOString(), before.start_at);
  assert.strictEqual(event.end.toISOString(), before.end_at);
});

r.test('cancellation approval removes the linked event and releases reserved capacity', () => {
  const ctx = makeCtx();
  const created = makeBooking(ctx);
  ctx.SheetStore.setSetting('customer_cancellation_enabled', 'true');
  ctx.BookingService.requestCancellation(created.manage_token);
  const bookingId = created.booking.booking_id;
  const updated = ctx.BookingService.approveCancellation(bookingId, 'owner@example.com');
  assert.strictEqual(updated.status, 'CANCELLED');
  assert.strictEqual(ctx._createdEvents[0]._deleted, true);
  assert.strictEqual(ctx.BookingStore.listActive(created.booking.start_at, created.booking.end_at, 'SRV_demo').length, 0);
  assert.strictEqual(ctx.BookingStore.getById(bookingId).cancelled_at !== '', true);
  assert.strictEqual(ctx.SheetStore.readAll('BookingEvents').slice(-1)[0].event_type, 'BOOKING_CANCELLED');
  assert.strictEqual(ctx._sentEmails.slice(-1)[0].type, 'cancel-approved');
  assert.deepStrictEqual(ctx._operationOrder.slice(-3), ['flush', 'unlock', 'email']);
});

r.test('retrying an idempotent cancellation retries Calendar cleanup after partial Sheet rollback', () => {
  const ctx = makeCtx();
  const created = makeBooking(ctx);
  const originalDelete = ctx.CalendarGateway.deleteEvent;
  let failOnce = true;
  ctx.CalendarGateway.deleteEvent = id => {
    if (failOnce) { failOnce = false; throw new Error('temporary calendar failure'); }
    return originalDelete(id);
  };
  ctx._failUpdateAfter.Bookings = 3;
  assert.throws(() => ctx.BookingService.cancel(created.booking.booking_id, 'owner@example.com'),
    e => e.domainCode === 'INTERNAL_ERROR');
  assert.strictEqual(ctx.BookingStore.getById(created.booking.booking_id).status, 'CANCELLED');
  assert.strictEqual(ctx._createdEvents[0]._deleted, false);
  assert.strictEqual(ctx.BookingService.cancel(created.booking.booking_id, 'owner@example.com').status, 'CANCELLED');
  assert.strictEqual(ctx._createdEvents[0]._deleted, true);
});

r.test('rejecting a cancellation request returns it to confirmed and retains capacity', () => {
  const ctx = makeCtx();
  const created = makeBooking(ctx);
  ctx.SheetStore.setSetting('customer_cancellation_enabled', 'true');
  ctx.BookingService.requestCancellation(created.manage_token);
  const updated = ctx.BookingService.rejectCancellation(created.booking.booking_id, 'owner@example.com');
  assert.strictEqual(updated.status, 'CONFIRMED');
  assert.strictEqual(ctx.BookingStore.listActive(created.booking.start_at, created.booking.end_at, 'SRV_demo').length, 1);
  assert.strictEqual(ctx.SheetStore.readAll('BookingEvents').slice(-1)[0].event_type, 'CANCELLATION_REJECTED');
  assert.strictEqual(ctx._sentEmails.slice(-1)[0].type, 'cancel-rejected');
  assert.deepStrictEqual(ctx._operationOrder.slice(-3), ['flush', 'unlock', 'email']);
});

r.test('lifecycle delivery failures do not roll back durable cancellation or reschedule state', () => {
  const ctx = makeCtx({ emailFailure: true });
  const created = makeBooking(ctx);
  const before = ctx.BookingStore.getById(created.booking.booking_id);
  const nextStart = new Date(new Date(before.start_at).getTime() + 3600000).toISOString();
  const moved = ctx.BookingService.reschedule(before.booking_id, { start_at: nextStart }, 'owner@example.com');
  assert.strictEqual(ctx.BookingStore.getById(before.booking_id).start_at, nextStart);
  assert.strictEqual(moved.start_at, nextStart);
  ctx.SheetStore.setSetting('customer_cancellation_enabled', 'true');
  ctx.BookingService.requestCancellation(created.manage_token);
  const cancelled = ctx.BookingService.approveCancellation(before.booking_id, 'owner@example.com');
  assert.strictEqual(cancelled.status, 'CANCELLED');
  assert.strictEqual(ctx.BookingStore.getById(before.booking_id).status, 'CANCELLED');
});

r.test('completed and no-show are rejected before start and idempotent after start', () => {
  const ctx = makeCtx();
  const created = makeBooking(ctx);
  const id = created.booking.booking_id;
  assert.throws(() => ctx.BookingService.markCompleted(id, 'owner@example.com'), e => e.domainCode === 'INVALID_STATE');
  assert.throws(() => ctx.BookingService.markNoShow(id, 'owner@example.com'), e => e.domainCode === 'INVALID_STATE');
  const past = new Date(Date.now() - 3600000).toISOString();
  ctx.SheetStore.updateById('Bookings', 'booking_id', id, { start_at: past, end_at: new Date(Date.now() - 1800000).toISOString() });
  assert.strictEqual(ctx.BookingService.markCompleted(id, 'owner@example.com').status, 'COMPLETED');
  assert.strictEqual(ctx.BookingService.markCompleted(id, 'owner@example.com').status, 'COMPLETED');
  const other = makeBooking(ctx);
  ctx.SheetStore.updateById('Bookings', 'booking_id', other.booking.booking_id,
    { start_at: new Date(Date.now() - 7200000).toISOString(), end_at: new Date(Date.now() - 5400000).toISOString() });
  assert.strictEqual(ctx.BookingService.markNoShow(other.booking.booking_id, 'owner@example.com').status, 'NO_SHOW');
  assert.strictEqual(ctx.BookingService.markNoShow(other.booking.booking_id, 'owner@example.com').status, 'NO_SHOW');
  assert.strictEqual(ctx.SheetStore.readAll('BookingEvents').filter(e => e.booking_id === id && e.event_type === 'COMPLETED').length, 1);
});

r.test('failed Calendar reschedule leaves booking and event interval unchanged', () => {
  const ctx = makeCtx();
  const created = makeBooking(ctx);
  const before = ctx.BookingStore.getById(created.booking.booking_id);
  const event = ctx._createdEvents[0];
  ctx._failCalendarUpdate = true;
  assert.throws(() => ctx.BookingService.reschedule(before.booking_id,
    { start_at: new Date(new Date(before.start_at).getTime() + 3600000).toISOString() }, 'owner@example.com'),
  e => e.domainCode === 'INTERNAL_ERROR');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.BookingStore.getById(before.booking_id))), JSON.parse(JSON.stringify(before)));
  assert.strictEqual(event._deleted, false);
  assert.strictEqual(event.start.toISOString(), before.start_at);
  assert.strictEqual(event.end.toISOString(), before.end_at);
});

if (require.main === module) process.exit(r.done() === 0 ? 0 : 1);
