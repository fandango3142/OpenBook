const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeCtx, cmd } = require('./booking-service.test');
const { createRunner } = require('./_runner');

const r = require.main === module ? createRunner('Generated-ID Apps Script smoke helpers') : { test: function () {} };

function context(options = {}) {
  const ctx = makeCtx(options);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'test-booking.gs'), 'utf8'), ctx,
    { filename: 'test-booking.gs' });
  return ctx;
}

r.test('refuses to run before the sheet is explicitly marked disposable', () => {
  const ctx = context();
  const before = JSON.stringify(Object.values(ctx._sheets).map(sheet => sheet.rows));
  const result = ctx.runBookingSmokeTest();
  assert.strictEqual(result.passed, false);
  assert.match(result.error, /smoke_test_mode/);
  assert.strictEqual(JSON.stringify(Object.values(ctx._sheets).map(sheet => sheet.rows)), before);
});

r.test('runs capacity, cancellation, approval, and reschedule checks then cleans only its generated records', () => {
  const ctx = context();
  ctx.SheetStore.setSetting('smoke_test_mode', 'true');
  ctx.SheetStore.setSetting('customer_cancellation_enabled', 'true');
  const unrelated = ctx.BookingService.create(cmd({ email: 'ordinary@example.com', name: 'Existing customer' }), 'PUBLIC');

  const result = ctx.runBookingSmokeTest();

  assert.strictEqual(result.passed, true, result.error || JSON.stringify(result.steps));
  assert.ok(result.prefix.startsWith('OBSMOKE_'));
  assert.ok(result.steps.some(step => step.name === 'capacity_rejection' && step.passed));
  assert.ok(result.steps.some(step => step.name === 'cancellation_request_retains_capacity' && step.passed));
  assert.ok(result.steps.some(step => step.name === 'approval_releases_capacity' && step.passed));
  assert.ok(result.steps.some(step => step.name === 'reschedule_preserves_booking_id' && step.passed));
  assert.deepStrictEqual(Array.from(ctx.SheetStore.readAll('Bookings'), row => row.booking_id), [unrelated.booking.booking_id]);
  assert.ok(ctx.SheetStore.readAll('Services').every(row => row.service_id === 'SRV_demo'));
  assert.ok(ctx.SheetStore.readAll('Availability').every(row => row.service_id === 'SRV_demo'));
  assert.strictEqual(ctx._createdEvents.filter(event => !event._deleted).length, 1);
  assert.strictEqual(ctx._createdEvents[0]._deleted, false);
});

if (require.main === module) process.exit(r.done() === 0 ? 0 : 1);
