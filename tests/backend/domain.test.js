const assert = require('assert');
const { loadBackend } = require('./gas-harness');
const { createRunner } = require('./_runner');

const ctx = loadBackend({}, ['Domain.gs', 'Token.gs']);
const r = createRunner('Domain and management tokens');

r.test('durable IDs use the requested prefix and a brace-free UUID', function () {
  assert.strictEqual(ctx.Domain.newId('BKG'), 'BKG_token-1');
  assert.strictEqual(ctx.Domain.newId('CUS'), 'CUS_token-2');
  const getUuid = ctx.Utilities.getUuid;
  ctx.Utilities.getUuid = function () { return '{uuid-with-braces}'; };
  assert.strictEqual(ctx.Domain.newId('EVT'), 'EVT_uuid-with-braces');
  ctx.Utilities.getUuid = getUuid;
});

r.test('only the approved lifecycle transitions are allowed', function () {
  const booking = { start_at: '2026-10-01T10:00:00Z' };
  const now = new Date('2026-10-02T10:00:00Z');
  const allowed = {
    CONFIRMED: ['CANCELLATION_REQUESTED', 'RESCHEDULE_REQUESTED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'],
    CANCELLATION_REQUESTED: ['CONFIRMED', 'CANCELLED'],
    RESCHEDULE_REQUESTED: ['CONFIRMED'],
    CANCELLED: [], COMPLETED: [], NO_SHOW: [],
  };
  Object.keys(allowed).forEach(function (from) {
    Object.keys(allowed).forEach(function (to) {
      assert.strictEqual(ctx.Domain.canTransition(from, to, booking, now), allowed[from].includes(to), from + ' -> ' + to);
    });
  });
  assert.strictEqual(ctx.Domain.canTransition('confirmed', 'CANCELLED', booking, now), false);
  assert.strictEqual(ctx.Domain.canTransition('UNKNOWN', 'CONFIRMED', booking, now), false);
});

r.test('future bookings cannot be completed or marked no-show', function () {
  const future = { status: 'CONFIRMED', start_at: '2026-10-03T10:00:00Z' };
  const now = new Date('2026-10-02T10:00:00Z');
  assert.strictEqual(ctx.Domain.canTransition('CONFIRMED', 'COMPLETED', future, now), false);
  assert.strictEqual(ctx.Domain.canTransition('CONFIRMED', 'NO_SHOW', future, now), false);
  assert.strictEqual(ctx.Domain.canTransition('CONFIRMED', 'CANCELLED', future, now), true);
  assert.strictEqual(ctx.Domain.canTransition('CONFIRMED', 'COMPLETED', { start_at: 'bad date' }, now), false);
  assert.strictEqual(ctx.Domain.canTransition('CONFIRMED', 'COMPLETED', null, now), false);
});

r.test('pending requests retain only overlapping capacity', function () {
  ['CONFIRMED', 'CANCELLATION_REQUESTED', 'RESCHEDULE_REQUESTED'].forEach(function (status) {
    const booking = { status: status, start_at: '2026-10-03T10:00:00Z', end_at: '2026-10-03T11:00:00Z' };
    assert.strictEqual(ctx.Domain.consumesCapacity(booking, '2026-10-03T10:30:00Z', '2026-10-03T11:30:00Z'), true, status);
    assert.strictEqual(ctx.Domain.consumesCapacity(booking, '2026-10-03T11:00:00Z', '2026-10-03T12:00:00Z'), false, status);
  });
  ['CANCELLED', 'COMPLETED', 'NO_SHOW', 'confirmed'].forEach(function (status) {
    assert.strictEqual(ctx.Domain.consumesCapacity({ status: status, start_at: '2026-10-03T10:00:00Z', end_at: '2026-10-03T11:00:00Z' }, '2026-10-03T10:30:00Z', '2026-10-03T11:30:00Z'), false, status);
  });
});

r.test('invalid intervals do not consume capacity', function () {
  assert.strictEqual(ctx.Domain.consumesCapacity({ status: 'CONFIRMED', start_at: 'bad', end_at: '2026-10-03T11:00:00Z' }, '2026-10-03T10:30:00Z', '2026-10-03T11:30:00Z'), false);
  assert.strictEqual(ctx.Domain.consumesCapacity({ status: 'CONFIRMED', start_at: '2026-10-03T10:00:00Z', end_at: '2026-10-03T11:00:00Z' }, '2026-10-03T11:30:00Z', '2026-10-03T11:00:00Z'), false);
});

r.test('issues a token with a SHA-256 digest rather than storing plaintext', function () {
  const issued = ctx.TokenService.issue();
  assert.strictEqual(issued.token, 'token-3');
  assert.strictEqual(issued.hash, 'a2f2b0b588bcc84fbf4d2ac8cc086b6f84de3e00fa3c1ba11e38ac078eb03192');
  assert.notStrictEqual(issued.token, issued.hash);
  assert.strictEqual(ctx.TokenService.matches(issued.token, issued.hash), true);
  assert.strictEqual(ctx.TokenService.matches('wrong-token', issued.hash), false);
  assert.strictEqual(ctx.TokenService.matches('', issued.hash), false);
});

r.test('hashToken remains a compatibility alias for the existing booking store', function () {
  assert.strictEqual(ctx.TokenService.hashToken('abc'), ctx.TokenService.hash('abc'));
  assert.strictEqual(ctx.TokenService.hash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

process.exit(r.done() === 0 ? 0 : 1);
