const assert = require('assert');
const { loadBackend, parseResponse } = require('./gas-harness');
const { createRunner } = require('./_runner');

const r = createRunner('versioned sheet schema and storage');
const headers = {
  Services: ['service_id', 'name', 'description', 'duration_minutes', 'buffer_before_minutes', 'buffer_after_minutes', 'capacity', 'active'],
  Availability: ['availability_id', 'service_id', 'weekday', 'start_time', 'end_time', 'active'],
  AvailabilityExceptions: ['exception_id', 'service_id', 'start_at', 'end_at', 'reason', 'active'],
  Customers: ['customer_id', 'name', 'email', 'phone', 'created_at', 'updated_at'],
  Bookings: ['booking_id', 'service_id', 'service_name_snapshot', 'duration_minutes_snapshot', 'customer_id', 'customer_name_snapshot', 'customer_email_snapshot', 'customer_phone_snapshot', 'start_at', 'end_at', 'quantity', 'status', 'calendar_event_id', 'manage_token_hash', 'created_at', 'updated_at', 'cancelled_at', 'completed_at'],
  BookingEvents: ['event_id', 'booking_id', 'event_type', 'actor', 'timestamp', 'metadata_json'],
  Settings: ['key', 'value'],
};
function makeCtx(opts) {
  return loadBackend(Object.assign({ config: { SPREADSHEET_ID: 'test-sheet' }, sheets: {} }, opts), ['SheetStore.gs', 'Schema.gs']);
}

r.test('creates schema v1 and exact domain headers on an empty spreadsheet', function () {
  const ctx = makeCtx();
  assert.strictEqual(ctx.Schema.ensureCurrent(), 1);
  Object.keys(headers).forEach(function (name) {
    assert.deepStrictEqual(Array.from(ctx._sheets[name].rows[0]), headers[name]);
  });
  assert.deepStrictEqual(ctx._sheets.Settings.rows[1], ['schema_version', 1]);
});

r.test('migration is idempotent and rejects newer schemas', function () {
  const ctx = makeCtx();
  ctx.Schema.ensureCurrent();
  ctx.Schema.ensureCurrent();
  assert.strictEqual(ctx._sheets.Services.createCount, 1);
  ctx._setSetting('schema_version', '2');
  assert.throws(() => ctx.Schema.ensureCurrent(), /newer than this code/);
});

r.test('migration preserves existing header order and values while adding missing columns', function () {
  const ctx = makeCtx({ sheets: { Services: [['name', 'service_id'], ['Consultation', 'svc-1']] } });
  ctx.runMigrations();
  assert.deepStrictEqual(ctx._sheets.Services.rows[0].slice(0, 2), ['name', 'service_id']);
  assert.deepStrictEqual(ctx._sheets.Services.rows[1].slice(0, 2), ['Consultation', 'svc-1']);
  assert.strictEqual(ctx._sheets.Services.rows[0].length, headers.Services.length);
});

r.test('failed migration leaves schema version unset and can be retried', function () {
  const ctx = makeCtx({ failAppendFor: ['Availability'] });
  assert.throws(() => ctx.Schema.ensureCurrent(), /append failed/);
  assert.strictEqual(ctx.SheetStore.getSetting('schema_version'), '');
  ctx._failAppendFor.length = 0;
  assert.strictEqual(ctx.Schema.ensureCurrent(), 1);
  assert.deepStrictEqual(Array.from(ctx._sheets.Availability.rows[0]), headers.Availability);
});

r.test('storage maps records by actual headers and updates by stable ID', function () {
  const ctx = makeCtx({ sheets: { Services: [['name', 'service_id', 'capacity'], ['Old', 'svc-1', 1]] } });
  ctx.SheetStore.append('Services', { service_id: 'svc-2', name: 'New', capacity: 2 });
  assert.deepStrictEqual(ctx._sheets.Services.rows[2], ['New', 'svc-2', 2]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.SheetStore.readAll('Services')[1])), { name: 'New', service_id: 'svc-2', capacity: 2 });
  assert.strictEqual(ctx.SheetStore.updateById('Services', 'service_id', 'svc-1', { capacity: 3 }), true);
  assert.strictEqual(ctx._sheets.Services.rows[1][2], 3);
  assert.strictEqual(ctx.SheetStore.updateById('Services', 'service_id', 'absent', { capacity: 4 }), false);
});

r.test('storage rejects unknown columns and propagates write failures', function () {
  const ctx = makeCtx({ sheets: { Services: [['service_id', 'name'], ['svc-1', 'Old']] }, failUpdateFor: ['Services'] });
  assert.throws(() => ctx.SheetStore.append('Services', { typo: 'value' }), /Unknown column/);
  assert.throws(() => ctx.SheetStore.updateById('Services', 'service_id', 'svc-1', { name: 'New' }), /update failed/);
  assert.strictEqual(ctx._sheets.Services.rows[1][1], 'Old');
});

r.test('normal routed request initializes schema before handling the action', function () {
  const ctx = loadBackend({ config: { SPREADSHEET_ID: 'test-sheet' }, sheets: {} }, ['SheetStore.gs', 'Schema.gs', 'Availability.gs', 'BookingService.gs', 'Code.gs']);
  const response = parseResponse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'getAvailability' }) } }));
  assert.strictEqual(response.error, 'VALIDATION_ERROR');
  assert.strictEqual(String(ctx.SheetStore.getSetting('schema_version')), '1');
  assert.ok(ctx._sheets.Services);
});

r.test('routed request fails closed without exposing a newer stored schema', function () {
  const ctx = loadBackend({
    config: { SPREADSHEET_ID: 'test-sheet' },
    sheets: { Settings: [['key', 'value'], ['schema_version', '2']] },
  }, ['SheetStore.gs', 'Schema.gs', 'Code.gs']);
  const response = parseResponse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'getAvailability' }) } }));
  assert.strictEqual(response.error, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(response).includes('newer than this code'));
  assert.strictEqual(ctx._sheets.Services, undefined);
});

r.test('reentrant first-run migration cannot create duplicate schema version rows', function () {
  const ctx = makeCtx({ sheets: { Settings: [['key', 'value']] } });
  const settings = ctx._sheets.Settings;
  const originalAppend = settings.appendRow;
  let blocked = false;
  settings.appendRow = function (row) {
    if (row[0] === 'schema_version') {
      try { ctx.Schema.ensureCurrent(); } catch (err) { blocked = /lock/i.test(err.message); }
    }
    return originalAppend.call(this, row);
  };
  ctx.Schema.ensureCurrent();
  assert.strictEqual(blocked, true);
  assert.strictEqual(settings.rows.filter(row => row[0] === 'schema_version').length, 1);
});

r.test('updateById rejects duplicate IDs before changing any row', function () {
  const ctx = makeCtx({ sheets: { Services: [['service_id', 'name'], ['svc-1', 'A'], ['svc-1', 'B']] } });
  assert.throws(() => ctx.SheetStore.updateById('Services', 'service_id', 'svc-1', { name: 'New' }), /duplicate/i);
  assert.deepStrictEqual(ctx._sheets.Services.rows.slice(1), [['svc-1', 'A'], ['svc-1', 'B']]);
});

r.test('duplicate stored schema versions fail closed', function () {
  const ctx = makeCtx({ sheets: { Settings: [['key', 'value'], ['schema_version', '1'], ['schema_version', '2']] } });
  assert.throws(() => ctx.Schema.ensureCurrent(), /duplicate/i);
  assert.strictEqual(ctx._sheets.Services, undefined);
});

process.exit(r.done() === 0 ? 0 : 1);
