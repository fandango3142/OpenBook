# OpenBook Booking Engine Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a capacity-safe Google Apps Script booking engine that can accept, manage, reschedule, and cancel real bookings without creating invalid or double bookings.

**Architecture:** Import the MIT-licensed `ContextLab/scheduler` frontend, Apps Script modules, and test harness, then replace its Calendar-defined availability and binary overlap model with a Sheets-configured domain service. Keep Google services behind adapters, route public and spreadsheet-bound manual operations through the same booking service, and verify mutations under `LockService` with append-only events and compensating rollback.

**Tech Stack:** Google Apps Script V8, Google Sheets, Google Calendar Advanced Service and `CalendarApp`, `MailApp`, static HTML/CSS/vanilla JavaScript, Node.js backend test harness, Jest/jsdom frontend tests.

**Spec:** `docs/superpowers/specs/2026-10-02-booking-engine-design.md`

## Global Constraints

- Preserve the upstream MIT license and copyright notice.
- Use generic product concepts: Business, Customer, Service, Booking, Availability, Capacity, Payment, and Resource.
- Do not collect purpose, notes, profiles, demographics, or other sensitive free-form customer data.
- Google Sheets is authoritative for booking state and capacity; Calendar is a conflict input and confirmed-event output.
- Every state-changing booking operation must acquire `LockService`, reload authoritative inputs, and revalidate availability.
- A service has positive integer capacity, default `1`; booking quantity is a positive integer.
- Use generated durable IDs with `SRV_`, `CUS_`, `BKG_`, and `EVT_` prefixes; never use Sheet row numbers as identifiers.
- Store only SHA-256 management-token hashes; return/email the plaintext token once.
- Interpret availability in the configured IANA business timezone and preserve instants across browser, business, and Calendar timezone differences.
- Only `CONFIRMED`, `CANCELLATION_REQUESTED`, and `RESCHEDULE_REQUESTED` bookings consume overlapping capacity.
- Reject `COMPLETED` and `NO_SHOW` before the booking start time.
- Establish `schema_version = 1`; migrations must be ordered, idempotent, and automatic.
- Defer OTP, temporary holds, Turnstile, pricing, payments, reconciliation, polished setup, analytics, and staff/resource routing.

## Target File Structure

```text
backend/
  Code.gs                 public HTTP routing and safe responses
  Config.gs               settings access and defaults
  Schema.gs               schema v1 and ordered migrations
  SheetStore.gs           header-aware Sheet reads/writes
  ServiceStore.gs         services and settings queries
  AvailabilityStore.gs    recurring windows and exceptions
  CustomerStore.gs        minimal customer persistence
  Booking.gs              bookings and append-only event persistence
  Domain.gs               lifecycle and pure validation rules
  Time.gs                 business-timezone conversion
  Availability.gs         slot generation and capacity calculation
  Calendar.gs             conflict/event gateway
  Token.gs                generate/hash/verify management tokens
  BookingService.gs       locked create/cancel/reschedule orchestration
  Email.gs                escaped lifecycle messages
  Dashboard.gs            authorized spreadsheet-bound RPC methods
  Dashboard.html          operational dashboard UI
  appsscript.json         scopes, timezone, and Advanced Calendar service
js/
  api-client.js            public API client
  app.js                   public booking flow
  booking-form.js          privacy-minimal contact/quantity form
  calendar.js              service-aware slot display
  timezone.js              browser display conversion only
tests/backend/
  gas-harness.js           fake Google boundaries and multi-sheet storage
  schema.test.js
  domain.test.js
  timezone.test.js
  availability.test.js
  booking-service.test.js
  lifecycle.test.js
  handlers.test.js
  dashboard.test.js
tests/frontend/
  booking-form.test.js
  booking-submit.test.js
  calendar.test.js
  manage-page.test.js
  dashboard.test.js
index.html
manage.html
cancel.html               replaced by redirect-compatible manage flow
reschedule.html           replaced by redirect-compatible manage flow
LICENSE
UPSTREAM.md
```

---

### Task 1: Import and Pin the Upstream Baseline

**Files:**
- Create from upstream: `backend/**`, `config/**`, `css/**`, `js/**`, `lib/**`, `tests/**`, `index.html`, `cancel.html`, `reschedule.html`, `package.json`, `LICENSE`
- Create: `UPSTREAM.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: upstream commit `c92dec7` from `https://github.com/ContextLab/scheduler`
- Produces: reproducible baseline where `npm test` invokes backend Node tests and frontend Jest tests

- [ ] **Step 1: Add the upstream remote and import the pinned tree without replacing the existing OpenBook history**

```powershell
git remote add upstream https://github.com/ContextLab/scheduler.git
git fetch upstream main
git checkout c92dec7 -- backend config css js lib tests index.html cancel.html reschedule.html package.json LICENSE README.md
```

- [ ] **Step 2: Install the pinned test dependencies**

Run: `npm ci --prefix tests/frontend`

Expected: Jest dependencies install from `tests/frontend/package-lock.json` without changing the lockfile.

- [ ] **Step 3: Run the unmodified upstream test suite**

Run: `npm test`

Expected: all backend and frontend tests pass before OpenBook changes.

- [ ] **Step 4: Record provenance and scope**

Create `UPSTREAM.md` containing:

```markdown
# Upstream attribution

OpenBook began from ContextLab/scheduler at commit `c92dec7`.
Upstream: https://github.com/ContextLab/scheduler
License: MIT; see `LICENSE`.

OpenBook replaces the upstream availability, storage, lifecycle, privacy, and
capacity model while retaining attribution for reused code.
```

Replace vertical-specific README copy with the OpenBook objective and link to the milestone spec; do not document deferred features as implemented.

- [ ] **Step 5: Commit the reproducible baseline**

```powershell
git add backend config css js lib tests index.html cancel.html reschedule.html package.json LICENSE README.md UPSTREAM.md
git commit -m "chore: import scheduler upstream baseline"
```

---

### Task 2: Add Schema Versioning and Header-Safe Storage

**Files:**
- Create: `backend/Schema.gs`
- Create: `backend/SheetStore.gs`
- Create: `tests/backend/schema.test.js`
- Modify: `backend/Config.gs`
- Modify: `tests/backend/gas-harness.js`
- Remove after replacement: `backend/Migration.gs`
- Replace: `tests/backend/migration.test.js`

**Interfaces:**
- Produces: `Schema.CURRENT_VERSION`, `Schema.ensureCurrent()`, global `runMigrations()`, `SheetStore.readAll(name)`, `SheetStore.append(name, record)`, `SheetStore.updateById(name, idColumn, id, patch)`, `SheetStore.ensureSheet(name, headers)`

- [ ] **Step 1: Write failing schema tests**

```javascript
r.test('creates schema v1 on an empty spreadsheet', function () {
  const ctx = makeCtx({ sheets: {} });
  assert.strictEqual(ctx.Schema.ensureCurrent(), 1);
  assert.strictEqual(ctx._sheets.Settings.rows[1][0], 'schema_version');
  assert.strictEqual(String(ctx._sheets.Settings.rows[1][1]), '1');
  assert.deepStrictEqual(ctx._sheets.Services.rows[0], ctx.Schema.HEADERS.Services);
});

r.test('migration is idempotent and rejects newer schemas', function () {
  const ctx = makeCtx({ settings: { schema_version: '1' } });
  ctx.Schema.ensureCurrent();
  ctx.Schema.ensureCurrent();
  assert.strictEqual(ctx._sheets.Services.createCount, 1);
  ctx._setSetting('schema_version', '2');
  assert.throws(() => ctx.Schema.ensureCurrent(), /newer than this code/);
});
```

- [ ] **Step 2: Run the test and verify the missing schema API**

Run: `node tests/backend/schema.test.js`

Expected: FAIL because `Schema` and multi-sheet harness support do not exist.

- [ ] **Step 3: Extend the harness with named in-memory sheets and failure injection**

Add `opts.sheets`, `opts.failAppendFor`, `opts.failUpdateFor`, `_sheets`, and Sheet methods used by production code. Preserve old `bookingRows` compatibility only until Task 5 migrates remaining tests.

```javascript
function makeSheet(name, rows) {
  return {
    name: name,
    rows: (rows || []).map((r) => r.slice()),
    createCount: 1,
    getDataRange: function () { return rangeFor(this.rows); },
    appendRow: function (row) { this.rows.push(row.slice()); },
    getLastRow: function () { return this.rows.length; },
    getLastColumn: function () { return this.rows[0] ? this.rows[0].length : 0; }
  };
}
```

- [ ] **Step 4: Implement schema v1 and ordered migrations**

Define exact headers from the design for `Services`, `Availability`, `AvailabilityExceptions`, `Customers`, `Bookings`, `BookingEvents`, and `Settings`. Implement:

```javascript
var Schema = (function () {
  var CURRENT_VERSION = 1;
  function ensureCurrent() {
    var stored = Number(SheetStore.getSetting('schema_version') || 0);
    if (stored > CURRENT_VERSION) throw new Error('Stored schema is newer than this code');
    for (var next = stored + 1; next <= CURRENT_VERSION; next++) MIGRATIONS[next]();
    return CURRENT_VERSION;
  }
  return { CURRENT_VERSION: CURRENT_VERSION, HEADERS: HEADERS, ensureCurrent: ensureCurrent };
})();
function runMigrations() { return Schema.ensureCurrent(); }
```

Each migration calls `ensureSheet`, adds missing headers without reordering existing data, and writes `schema_version` only at the end.

- [ ] **Step 5: Run schema tests and the complete baseline suite**

Run: `node tests/backend/schema.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit schema infrastructure**

```powershell
git add backend/Schema.gs backend/SheetStore.gs backend/Config.gs tests/backend/gas-harness.js tests/backend/schema.test.js tests/backend/migration.test.js
git rm backend/Migration.gs
git commit -m "feat: add versioned sheet schema"
```

---

### Task 3: Implement Domain IDs, Lifecycle Rules, and Token Hashing

**Files:**
- Create: `backend/Domain.gs`
- Modify: `backend/Token.gs`
- Create: `tests/backend/domain.test.js`
- Modify: `tests/backend/gas-harness.js`

**Interfaces:**
- Produces: `Domain.newId(prefix)`, `Domain.canTransition(from, to, booking, now)`, `Domain.consumesCapacity(booking, candidateStart, candidateEnd)`, `TokenService.issue() -> {token, hash}`, `TokenService.hash(token)`, `TokenService.matches(token, hash)`

- [ ] **Step 1: Write failing lifecycle, temporal-guard, overlap, and token tests**

```javascript
r.test('future bookings cannot be completed or marked no-show', function () {
  const future = { status: 'CONFIRMED', start_at: '2026-10-03T10:00:00Z' };
  assert.strictEqual(ctx.Domain.canTransition('CONFIRMED', 'COMPLETED', future, new Date('2026-10-02T10:00:00Z')), false);
  assert.strictEqual(ctx.Domain.canTransition('CONFIRMED', 'NO_SHOW', future, new Date('2026-10-02T10:00:00Z')), false);
});

r.test('pending requests retain only overlapping capacity', function () {
  const b = { status: 'CANCELLATION_REQUESTED', start_at: '2026-10-03T10:00:00Z', end_at: '2026-10-03T11:00:00Z' };
  assert.strictEqual(ctx.Domain.consumesCapacity(b, '2026-10-03T10:30:00Z', '2026-10-03T11:30:00Z'), true);
  assert.strictEqual(ctx.Domain.consumesCapacity(b, '2026-10-03T11:00:00Z', '2026-10-03T12:00:00Z'), false);
});

r.test('stores a digest rather than the issued token', function () {
  const issued = ctx.TokenService.issue();
  assert.notStrictEqual(issued.token, issued.hash);
  assert.strictEqual(ctx.TokenService.matches(issued.token, issued.hash), true);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node tests/backend/domain.test.js`

Expected: FAIL because the new domain/token interfaces are absent.

- [ ] **Step 3: Implement the explicit transition table and half-open overlap**

Use uppercase states exactly as specified. `newId('BKG')` returns `BKG_` plus a UUID without braces. `canTransition` checks the table and applies the passed clock to `COMPLETED` and `NO_SHOW`.

- [ ] **Step 4: Implement SHA-256 token hashing**

```javascript
function hash(token) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
```

`matches` computes the candidate digest and compares every character without early return. Remove token-expiry behavior from the upstream plaintext-token store; M1 tokens remain revocable only by booking terminal state or future migration.

- [ ] **Step 5: Run domain and full tests**

Run: `node tests/backend/domain.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit domain primitives**

```powershell
git add backend/Domain.gs backend/Token.gs tests/backend/domain.test.js tests/backend/gas-harness.js
git commit -m "feat: add booking domain primitives"
```

---

### Task 4: Build Timezone-Safe Recurring Availability

**Files:**
- Create: `backend/Time.gs`
- Create: `backend/ServiceStore.gs`
- Create: `backend/AvailabilityStore.gs`
- Replace: `backend/Calendar.gs`
- Create: `backend/Availability.gs`
- Create: `tests/backend/timezone.test.js`
- Replace: `tests/backend/calendar-availability.test.js`
- Create: `tests/backend/availability.test.js`

**Interfaces:**
- Produces: `TimeService.localDateTimeToInstant(localDate, localTime, zone, disambiguation)`, `TimeService.formatInZone(instant, zone)`, `ServiceStore.listActive()`, `ServiceStore.getById(id)`, `AvailabilityStore.listWindows(serviceId)`, `AvailabilityStore.listExceptions(serviceId, start, end)`, `CalendarGateway.listConflicts(start, end, linkedEventIds)`, `AvailabilityService.listSlots(request)`, `AvailabilityService.check(request)`

- [ ] **Step 1: Write failing timezone/DST tests**

```javascript
r.test('converts Kolkata business time independently of browser timezone', function () {
  assert.strictEqual(
    ctx.TimeService.localDateTimeToInstant('2026-10-03', '09:00', 'Asia/Kolkata', 'reject').toISOString(),
    '2026-10-03T03:30:00.000Z');
});

r.test('rejects missing spring-forward local time', function () {
  assert.throws(() => ctx.TimeService.localDateTimeToInstant('2026-03-08', '02:30', 'America/New_York', 'reject'), /nonexistent/);
});

r.test('requires explicit choice for repeated fall-back time', function () {
  assert.throws(() => ctx.TimeService.localDateTimeToInstant('2026-11-01', '01:30', 'America/New_York', 'reject'), /ambiguous/);
});
```

- [ ] **Step 2: Write failing recurring-window, exception, buffer, Calendar-conflict, and capacity tests**

Seed a service with capacity `3`, Monday windows `09:00–12:00` and `14:00–17:00`, a `10:00–10:30` exception, a `15:00–15:30` external conflict, and two overlapping confirmed quantities. Assert generated slots omit exceptions/conflicts and return `remaining_capacity` for all others.

- [ ] **Step 3: Run the focused tests and verify failure**

Run: `node tests/backend/timezone.test.js`

Run: `node tests/backend/availability.test.js`

Expected: both FAIL because the services do not exist.

- [ ] **Step 4: Implement timezone conversion without parsing locale-formatted dates**

Use `Utilities.formatDate` to compare candidate instants rendered in the IANA zone. Probe offsets around the target time, collect exact local-time matches, reject zero matches as nonexistent and more than one as ambiguous unless `earlier` or `later` is supplied. Calendar event instants remain ISO UTC.

- [ ] **Step 5: Implement Sheet-backed services, windows, and exceptions**

Map rows by headers through `SheetStore`; validate positive durations/capacity, `HH:mm` window values, weekday names, and exception intervals. Treat blank exception `service_id` as global.

- [ ] **Step 6: Implement pure slot generation and capacity checks**

```javascript
AvailabilityService.check({
  service_id: 'SRV_demo', start_at: '2026-10-05T03:30:00.000Z',
  quantity: 2, now: new Date('2026-10-02T00:00:00Z'),
  exclude_booking_id: null
});
// => {ok: true, end_at: '...', remaining_capacity: 1}
```

Apply buffers to containment, exception, and external-conflict checks. Capacity comes only from overlapping active scheduled Sheet rows. Exclude linked booking event IDs when the booking calendar is queried as a conflict calendar.

- [ ] **Step 7: Run focused and full tests**

Run: `node tests/backend/timezone.test.js`

Run: `node tests/backend/availability.test.js`

Run: `npm test`

Expected: PASS.

- [ ] **Step 8: Commit availability engine**

```powershell
git add backend/Time.gs backend/ServiceStore.gs backend/AvailabilityStore.gs backend/Calendar.gs backend/Availability.gs tests/backend/timezone.test.js tests/backend/calendar-availability.test.js tests/backend/availability.test.js
git commit -m "feat: add capacity-aware availability engine"
```

---

### Task 5: Implement the Locked Booking Transaction and Public Handlers

**Files:**
- Create: `backend/CustomerStore.gs`
- Replace: `backend/Booking.gs`
- Create: `backend/BookingService.gs`
- Replace: `backend/Code.gs`
- Create: `tests/backend/booking-service.test.js`
- Replace: `tests/backend/booking-integrity.test.js`
- Replace: `tests/backend/handlers.test.js`
- Modify: `tests/backend/gas-harness.js`

**Interfaces:**
- Produces: `CustomerStore.findOrCreate(data)`, `BookingStore.getById(id)`, `BookingStore.getByTokenHash(hash)`, `BookingStore.listActive(start, end, serviceId)`, `BookingStore.appendEvent(event)`, `BookingService.create(command, actor)`, handlers `listServices`, `getAvailability`, `createBooking`

- [ ] **Step 1: Write failing capacity and concurrency transaction tests**

```javascript
r.test('allows bookings up to capacity and rejects the next request', function () {
  const ctx = makeCtx({ serviceCapacity: 3 });
  assert.strictEqual(ctx.BookingService.create(cmd({quantity: 2}), 'PUBLIC').booking.quantity, 2);
  assert.strictEqual(ctx.BookingService.create(cmd({quantity: 1}), 'PUBLIC').booking.quantity, 1);
  assert.throws(() => ctx.BookingService.create(cmd({quantity: 1}), 'PUBLIC'), /INSUFFICIENT_CAPACITY/);
  assert.strictEqual(ctx._createdEvents.length, 2);
});

r.test('revalidates after lock acquisition and flushes before release', function () {
  const ctx = makeCtx({ onLock: seedCompetingBooking });
  assert.throws(() => ctx.BookingService.create(cmd({quantity: 1}), 'PUBLIC'), /INSUFFICIENT_CAPACITY/);
  assert.deepStrictEqual(ctx._operationOrder.slice(-2), ['flush', 'unlock']);
});
```

- [ ] **Step 2: Write failing rollback, privacy, ID, and token tests**

Assert Calendar creation followed by injected `Bookings` append failure deletes the event; email failure leaves a confirmed durable booking; records contain generated IDs and `manage_token_hash` but no plaintext token, purpose, or notes; events contain `BOOKING_CREATED` then `BOOKING_CONFIRMED`.

- [ ] **Step 3: Run tests and verify failure**

Run: `node tests/backend/booking-service.test.js`

Expected: FAIL against the upstream transaction.

- [ ] **Step 4: Implement customer, booking, and event stores**

Deduplicate customers by normalized lowercase email without revealing existence publicly. Snapshot customer/service display data on the booking. Keep writes header-aware and append events only.

- [ ] **Step 5: Implement `BookingService.create` with compensating rollback**

```javascript
function create(command, actor) {
  return LockGateway.withLock(10000, function () {
    Schema.ensureCurrent();
    var check = AvailabilityService.check(command);
    if (!check.ok) throw Domain.error(check.code);
    var issued = TokenService.issue();
    var event = CalendarGateway.createBookingEvent(buildEvent(command, check));
    try {
      var booking = BookingStore.create(buildBooking(command, check, issued.hash, event.id));
      BookingStore.appendEvent(Domain.event(booking.booking_id, 'BOOKING_CREATED', actor));
      BookingStore.appendEvent(Domain.event(booking.booking_id, 'BOOKING_CONFIRMED', 'SYSTEM'));
      SpreadsheetApp.flush();
      return { booking: publicBooking(booking), manage_token: issued.token };
    } catch (err) {
      CalendarGateway.deleteEvent(event.id);
      throw err;
    }
  });
}
```

Queue/send confirmation after the locked durable transaction. Log delivery errors without rolling back.

- [ ] **Step 6: Replace routing with stable actions and safe error mapping**

Accept `listServices`, `getAvailability`, and `createBooking`. Keep per-client and per-email limits and honeypot behavior. Map domain errors to the spec codes; map unexpected exceptions to `INTERNAL_ERROR` without exposing messages or stacks.

- [ ] **Step 7: Run backend and complete suites**

Run: `node tests/backend/booking-service.test.js`

Run: `node tests/backend/handlers.test.js`

Run: `npm test`

Expected: PASS.

- [ ] **Step 8: Commit the booking transaction**

```powershell
git add backend/CustomerStore.gs backend/Booking.gs backend/BookingService.gs backend/Code.gs tests/backend/booking-service.test.js tests/backend/booking-integrity.test.js tests/backend/handlers.test.js tests/backend/gas-harness.js
git commit -m "feat: add capacity-safe booking transaction"
```

---

### Task 6: Add Managed Booking and Cancellation Requests

**Files:**
- Modify: `backend/BookingService.gs`
- Modify: `backend/Code.gs`
- Create: `tests/backend/lifecycle.test.js`
- Create: `manage.html`
- Create: `js/manage.js`
- Create: `tests/frontend/manage-page.test.js`
- Modify: `cancel.html`
- Modify: `reschedule.html`

**Interfaces:**
- Produces: `BookingService.getManaged(token)`, `BookingService.requestCancellation(token)`, `BookingService.requestReschedule(token, requestedStart)`, public handlers `getManagedBooking`, `requestCancellation`, `requestReschedule`

- [ ] **Step 1: Write failing token-isolation, idempotency, and retained-capacity tests**

Assert a token returns only its booking; invalid tokens return `INVALID_TOKEN`; repeated cancellation request produces one lifecycle event/email; `CANCELLATION_REQUESTED` still blocks capacity; disabled customer rescheduling returns `INVALID_STATE`.

- [ ] **Step 2: Run lifecycle tests and verify failure**

Run: `node tests/backend/lifecycle.test.js`

Expected: FAIL because managed operations are absent.

- [ ] **Step 3: Implement locked request transitions**

Hash the presented token, reload the booking under lock, apply `Domain.canTransition`, update status, append the matching event, and flush before unlock. Store requested reschedule timestamps only in allowlisted event metadata; the original booking interval remains unchanged until business approval.

- [ ] **Step 4: Write failing manage-page tests**

Test loading by `?token=`, safe rendering, request buttons, disabled actions by state, and no token written to visible text or logs.

- [ ] **Step 5: Implement a unified manage page and compatibility redirects**

`manage.html` loads only the associated booking and exposes request actions permitted by Settings. `cancel.html` and `reschedule.html` retain existing inbound links by redirecting to `manage.html?token=...` without analytics or third-party requests.

- [ ] **Step 6: Run focused and full tests**

Run: `node tests/backend/lifecycle.test.js`

Run: `npm --prefix tests/frontend test -- manage-page.test.js`

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit managed booking flows**

```powershell
git add backend/BookingService.gs backend/Code.gs tests/backend/lifecycle.test.js manage.html js/manage.js tests/frontend/manage-page.test.js cancel.html reschedule.html
git commit -m "feat: add secure managed booking requests"
```

---

### Task 7: Add Transactional Rescheduling and Business Lifecycle Operations

**Files:**
- Modify: `backend/BookingService.gs`
- Create: `backend/Dashboard.gs`
- Modify: `backend/Calendar.gs`
- Modify: `tests/backend/lifecycle.test.js`
- Create: `tests/backend/dashboard.test.js`
- Modify: `tests/backend/gas-harness.js`

**Interfaces:**
- Produces: `BookingService.reschedule(bookingId, replacement, actor)`, `BookingService.cancel(bookingId, actor)`, `BookingService.approveCancellation(bookingId, actor)`, `BookingService.rejectCancellation(bookingId, actor)`, `BookingService.markCompleted(bookingId, actor)`, `BookingService.markNoShow(bookingId, actor)`, `DashboardApi.*` authorized wrappers

- [ ] **Step 1: Write failing same-ID reschedule and rollback tests**

```javascript
r.test('reschedules in place and preserves id and token hash', function () {
  const before = seedBooking();
  const after = ctx.BookingService.reschedule(before.booking_id, replacement(), 'owner@example.com');
  assert.strictEqual(after.booking_id, before.booking_id);
  assert.strictEqual(after.manage_token_hash, before.manage_token_hash);
  assert.strictEqual(after.status, 'CONFIRMED');
});

r.test('failed replacement leaves original booking and event unchanged', function () {
  const before = seedBooking();
  ctx._failCalendarUpdate = true;
  assert.throws(() => ctx.BookingService.reschedule(before.booking_id, replacement(), 'owner@example.com'));
  assert.deepStrictEqual(ctx.BookingStore.getById(before.booking_id), before);
  assert.strictEqual(ctx._createdEvents[0]._deleted, false);
});
```

- [ ] **Step 2: Write failing authorization, cancellation approval, and temporal terminal-state tests**

Assert blank/unauthorized active users fail closed; cancellation approval removes the Calendar event and releases capacity; rejection returns to `CONFIRMED`; future `COMPLETED`/`NO_SHOW` fail; past transitions succeed once and are idempotent.

- [ ] **Step 3: Run tests and verify failure**

Run: `node tests/backend/dashboard.test.js`

Expected: FAIL because dashboard operations do not exist.

- [ ] **Step 4: Implement transactional rescheduling**

Under one lock, reload the booking, check replacement availability with `exclude_booking_id`, snapshot the old event interval, update the existing Calendar event, persist the same booking ID/token hash and append `BOOKING_RESCHEDULED`. If Sheet persistence fails, restore the Calendar event interval; if rollback fails, log a reconciliation-required error without claiming success.

- [ ] **Step 5: Implement business lifecycle methods and server-side authorization**

`DashboardApi.authorize()` obtains `Session.getActiveUser().getEmail()`, normalizes it, compares against the Settings allowlist, and throws `UNAUTHORIZED` on blank or mismatch. Every dashboard method calls it before reading customer data.

- [ ] **Step 6: Run focused and full tests**

Run: `node tests/backend/lifecycle.test.js`

Run: `node tests/backend/dashboard.test.js`

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit lifecycle operations**

```powershell
git add backend/BookingService.gs backend/Dashboard.gs backend/Calendar.gs tests/backend/lifecycle.test.js tests/backend/dashboard.test.js tests/backend/gas-harness.js
git commit -m "feat: add transactional booking management"
```

---

### Task 8: Replace Emails with Privacy-Safe Lifecycle Templates

**Files:**
- Replace: `backend/Email.gs`
- Remove: `tests/backend/reconcile.test.js`
- Create: `tests/backend/email.test.js`
- Remove: `backend/Reconcile.gs`

**Interfaces:**
- Produces: `EmailService.sendConfirmation(booking, plaintextToken)`, `sendCancellationRequested(booking)`, `sendCancellationApproved(booking)`, `sendCancellationRejected(booking)`, `sendRescheduled(booking, previousInterval)`

- [ ] **Step 1: Write failing escaping and variable-allowlist tests**

Assert `<img onerror=...>` in names renders escaped, arbitrary template variables remain unavailable, tokens appear only in the intended management URL, and emails omit purpose/notes/Calendar IDs/token hashes.

- [ ] **Step 2: Run tests and verify failure**

Run: `node tests/backend/email.test.js`

Expected: FAIL against upstream email templates.

- [ ] **Step 3: Implement fixed lifecycle templates**

Build text and minimal HTML bodies from an explicit data object containing only business name, customer name, service name, business-local date/time, booking ID, and management URL. Escape `& < > " '` before HTML insertion.

- [ ] **Step 4: Wire emails after durable mutations**

Send only after the lock-protected mutation succeeds. Catch delivery failures, log booking ID plus message type, and return booking success. Do not resurrect upstream automatic ghost cancellation; unresolved Sheet/Calendar drift fails closed and remains visible for later reconciliation work.

- [ ] **Step 5: Run focused and full tests**

Run: `node tests/backend/email.test.js`

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit lifecycle emails**

```powershell
git add backend/Email.gs tests/backend/email.test.js
git rm backend/Reconcile.gs tests/backend/reconcile.test.js
git commit -m "feat: add privacy-safe booking emails"
```

---

### Task 9: Adapt the Public Frontend to Services, Capacity, and Safe Errors

**Files:**
- Replace: `config/meeting-types.yaml`
- Modify: `index.html`
- Modify: `js/config-loader.js`
- Modify: `js/api-client.js`
- Modify: `js/app.js`
- Modify: `js/booking-form.js`
- Modify: `js/calendar.js`
- Modify: `css/styles.css`
- Modify: `tests/frontend/config-loader.test.js`
- Modify: `tests/frontend/booking-form.test.js`
- Modify: `tests/frontend/booking-submit.test.js`
- Create: `tests/frontend/calendar.test.js`

**Interfaces:**
- Consumes: public `listServices`, `getAvailability`, `createBooking`
- Produces: public flow `Service -> Date/slot -> Contact/quantity -> Confirm -> Success`

- [ ] **Step 1: Write failing privacy and quantity form tests**

Assert the form has name, email, optional phone, quantity, and honeypot; has no purpose/notes/format/location fields; quantity is hidden or fixed at `1` for capacity `1`, bounded by remaining capacity otherwise.

- [ ] **Step 2: Write failing service and stale-slot UI tests**

Assert services load from the API rather than YAML; slot cards show remaining capacity only when capacity exceeds one; `SLOT_UNAVAILABLE` and `INSUFFICIENT_CAPACITY` invalidate cached availability, return to slot selection, and refresh.

- [ ] **Step 3: Run frontend tests and verify failure**

Run: `npm --prefix tests/frontend test -- booking-form.test.js booking-submit.test.js calendar.test.js`

Expected: FAIL against the upstream meeting form.

- [ ] **Step 4: Simplify markup and form data**

Remove meeting-purpose, notes, meeting-format, location, and variable-duration controls. Duration comes from the chosen service. Add optional phone and integer quantity controls with accessible labels and errors.

- [ ] **Step 5: Replace YAML service loading with API loading**

Retain static site configuration only for the Apps Script endpoint and neutral branding. Service definitions and active state come from `listServices`.

- [ ] **Step 6: Implement capacity-aware slot and submission behavior**

Submit `{service_id, start_at, quantity, customer:{name,email,phone}, hp}`. Display business-local service times while allowing the browser to show an explicit local-time companion when zones differ. Never send browser-formatted timestamps back as authoritative values; use the slot ISO instant returned by the API.

- [ ] **Step 7: Run frontend and complete suites**

Run: `npm --prefix tests/frontend test`

Run: `npm test`

Expected: PASS.

- [ ] **Step 8: Commit the public flow**

```powershell
git add config/meeting-types.yaml index.html js/config-loader.js js/api-client.js js/app.js js/booking-form.js js/calendar.js css/styles.css tests/frontend/config-loader.test.js tests/frontend/booking-form.test.js tests/frontend/booking-submit.test.js tests/frontend/calendar.test.js
git commit -m "feat: add capacity-aware public booking flow"
```

---

### Task 10: Build the Spreadsheet-Bound Business Dashboard

**Files:**
- Create: `backend/Dashboard.html`
- Modify: `backend/Dashboard.gs`
- Modify: `backend/Code.gs`
- Create: `tests/frontend/dashboard.test.js`
- Modify: `tests/backend/dashboard.test.js`

**Interfaces:**
- Consumes: authorized `DashboardApi.listBookings`, `createManualBooking`, `rescheduleBooking`, `cancelBooking`, `approveCancellation`, `rejectCancellation`, `markCompleted`, `markNoShow`, `createAvailabilityException`
- Produces: Sheet menu `OpenBook -> Dashboard`, `OpenBook -> Run setup/migrations`

- [ ] **Step 1: Write failing menu and affected-booking tests**

Assert `onOpen()` installs the menu; unauthorized RPC calls fail; creating an availability exception returns overlapping active bookings without modifying their states or Calendar events.

- [ ] **Step 2: Write failing dashboard UI tests**

Using jsdom with a fake `google.script.run`, assert today/upcoming rendering, booking detail, manual booking using the shared service, reschedule, cancellation approval/rejection, terminal-state guards, and time blocking.

- [ ] **Step 3: Run tests and verify failure**

Run: `node tests/backend/dashboard.test.js`

Run: `npm --prefix tests/frontend test -- dashboard.test.js`

Expected: FAIL because the bound UI does not exist.

- [ ] **Step 4: Implement menu, dialog, and authorized RPC wrappers**

```javascript
function onOpen() {
  SpreadsheetApp.getUi().createMenu('OpenBook')
    .addItem('Dashboard', 'showDashboard')
    .addItem('Run setup / migrations', 'runMigrationsFromMenu')
    .addToUi();
}
```

Manual booking calls `BookingService.create(command, authorizedEmail)`; it must not write directly to Sheets or Calendar.

- [ ] **Step 5: Implement the minimum operational UI**

Provide today/upcoming lists, booking detail, manual booking, reschedule, direct cancellation, request approval/rejection, completed/no-show controls, and exception creation. Use plain HTML/CSS/JavaScript and `google.script.run`; do not add a framework or settings editor.

- [ ] **Step 6: Run focused and full tests**

Run: `node tests/backend/dashboard.test.js`

Run: `npm --prefix tests/frontend test -- dashboard.test.js`

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit the dashboard**

```powershell
git add backend/Dashboard.html backend/Dashboard.gs backend/Code.gs tests/backend/dashboard.test.js tests/frontend/dashboard.test.js
git commit -m "feat: add spreadsheet booking dashboard"
```

---

### Task 11: Verify the Complete Milestone and Document the Smoke Test

**Files:**
- Modify: `backend/appsscript.json`
- Replace: `backend/test-booking.gs`
- Replace: `backend/test-calendar.gs`
- Replace: `backend/test-email.gs`
- Modify: `README.md`
- Create: `docs/testing/milestone-1-smoke-test.md`
- Create: `docs/configuration/sheets.md`

**Interfaces:**
- Produces: automated verification via `npm test`; operator smoke-test checklist; accurate milestone documentation

- [ ] **Step 1: Add Apps Script smoke-test helpers that use generated test IDs**

Create functions that verify schema setup, slot generation, booking/event creation, capacity rejection, cancellation-request retention, approval release, and reschedule ID preservation. Each helper must clean up only rows/events with the generated test prefix and report IDs for manual recovery if cleanup fails.

- [ ] **Step 2: Document exact test-Sheet configuration**

Include sample Settings, one capacity-3 Service, two recurring windows, one exception, dedicated booking Calendar, conflict Calendar, and authorized dashboard email. State that the procedure uses test data and must not run against production.

- [ ] **Step 3: Run formatting/static checks available in the repository**

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 4: Run the complete automated suite from a clean dependency install**

Run: `npm ci --prefix tests/frontend`

Run: `npm test`

Expected: every backend Node and frontend Jest test passes.

- [ ] **Step 5: Run focused acceptance suites**

```powershell
node tests/backend/schema.test.js
node tests/backend/timezone.test.js
node tests/backend/availability.test.js
node tests/backend/booking-service.test.js
node tests/backend/lifecycle.test.js
node tests/backend/dashboard.test.js
npm --prefix tests/frontend test -- --runInBand
```

Expected: all commands exit `0`.

- [ ] **Step 6: Perform the live Google smoke test**

Follow `docs/testing/milestone-1-smoke-test.md` in a disposable Sheet and dedicated test Calendars. Record the Apps Script deployment version, business timezone, Calendar timezone, DST zone used for boundary verification, and pass/fail result for every acceptance item. Do not claim milestone completion if the live smoke test cannot be run.

- [ ] **Step 7: Review scope and privacy before final commit**

Run:

```powershell
rg -n "purpose|notes|patient|therapy|restaurant|salon|Stripe|payment|OTP|Turnstile" backend js index.html manage.html README.md
rg -n "manage_token_hash|manage_token|token" backend tests
```

Expected: no prohibited vertical/customer free-form fields; deferred feature mentions appear only as roadmap/non-features; plaintext management tokens are returned/emailed but never persisted or logged.

- [ ] **Step 8: Commit verified milestone documentation**

```powershell
git add backend/appsscript.json backend/test-booking.gs backend/test-calendar.gs backend/test-email.gs README.md docs/testing/milestone-1-smoke-test.md docs/configuration/sheets.md
git commit -m "docs: add milestone one verification guide"
```

- [ ] **Step 9: Request final code review**

Use the `requesting-code-review` skill against the complete branch. Address correctness, privacy, and scope findings, rerun `npm test` and `git diff --check`, and only then present the branch for integration.

