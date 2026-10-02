const assert = require('assert');
const { loadBackend } = require('./gas-harness');
const { createRunner } = require('./_runner');

const r = createRunner('schema migration of existing sheets');

r.test('keeps existing booking columns and data in place while adding domain headers', function () {
  const ctx = loadBackend({
    config: { SPREADSHEET_ID: 'test-sheet' },
    sheets: {
      Bookings: [['token', 'status'], ['old-token', 'confirmed']],
      Settings: [['value', 'key'], ['Old Name', 'business_name']],
    },
  }, ['SheetStore.gs', 'Schema.gs']);

  assert.strictEqual(ctx.runMigrations(), 1);
  assert.deepStrictEqual(ctx._sheets.Bookings.rows[0].slice(0, 2), ['token', 'status']);
  assert.deepStrictEqual(ctx._sheets.Bookings.rows[1].slice(0, 2), ['old-token', 'confirmed']);
  assert.deepStrictEqual(ctx._sheets.Settings.rows[0], ['value', 'key']);
  assert.deepStrictEqual(ctx._sheets.Settings.rows[1], ['Old Name', 'business_name']);
  assert.strictEqual(String(ctx.SheetStore.getSetting('schema_version')), '1');
  assert.strictEqual(ctx._sheets.Bookings.rows[0].length, 19);
});

process.exit(r.done() === 0 ? 0 : 1);
