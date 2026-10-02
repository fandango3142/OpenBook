# OpenBook Booking Engine — Milestone 1 Design

## Status

Approved in chat on 2 October 2026. This document defines the first implementation milestone: a correct, capacity-aware booking engine and its minimum customer and business interfaces.

## Objective

Build a free, independently deployable booking system on infrastructure the operator owns:

- A static public frontend
- A spreadsheet-bound Apps Script business dashboard
- Google Apps Script for server-side business logic
- Google Sheets for durable records and configuration
- Google Calendar for conflicts and confirmed booking events
- Gmail or Google Mail services for transactional email

The milestone prioritizes booking correctness, double-booking prevention, privacy, and data ownership. Installation polish follows after the engine is proven.

## Upstream Foundation

Fork `ContextLab/scheduler` and preserve its MIT license and copyright notices.

Reusable foundations include:

- Static frontend structure
- Modular Apps Script services
- Sheets-backed booking storage
- Google Calendar integration
- Email delivery
- Secure customer management links
- Cancellation and rescheduling interfaces
- Per-client throttling and honeypot protection
- Frontend test infrastructure

The following upstream behavior must be replaced:

- Binary booked/free checks become capacity accounting.
- Calendar-defined availability becomes Sheets-defined recurring availability and exceptions.
- Calendar remains a conflict source and destination for confirmed events.
- Free-form purpose and notes fields are removed.
- Rescheduling retains the original booking until the replacement is secured.
- Rescheduling preserves the booking ID and management token.
- Durable records use generated IDs instead of row numbers.
- Management tokens are stored as hashes rather than plaintext.

## Milestone Scope

### Included

- Multiple services
- Multiple recurring availability windows per weekday and service
- Hour, day, and date-range availability exceptions
- Configurable Calendar conflict blocking
- Rolling booking window and minimum notice
- Capacity-aware public booking
- Manual booking through the same engine
- Secure customer management links
- Customer cancellation requests
- Customer reschedule requests when enabled
- Business rescheduling
- Business cancellation approval and direct cancellation
- Minimal business dashboard
- Booking lifecycle emails
- Append-only booking event history
- Baseline rate limiting, honeypot protection, and input validation

### Deferred

- Email OTP verification
- Temporary verification holds
- Turnstile
- Variable pricing
- Payments and payment reconciliation
- Monthly reconciliation
- First-run wizard and polished copy-to-publish installation
- Complex staff or resource routing

The interfaces must leave room for OTP, holds, Turnstile, pricing, and payments without making them dependencies of the core booking engine.

## System Architecture

```text
Public Frontend         Sheets-bound Dashboard
       |                          |
  Public HTTP API          Apps Script RPC
       |                          |
       +---- Booking Domain Service ----+
                   /       |        \
              Sheets    Calendar    Email
```

The booking domain service owns validation, availability, capacity, lifecycle transitions, and transactional orchestration. Public and manual bookings call the same domain operation. The dashboard runs as a bound Apps Script interface opened from the operator's Sheet, so normal Google Sheet access controls form its authentication boundary; dashboard RPC methods still enforce an authorized-user allowlist.

Google integrations sit behind focused adapters so scheduling logic can be tested without live Google services:

- `SheetStore`: configuration and durable records
- `CalendarGateway`: conflict queries and event mutation
- `MailGateway`: templated email delivery
- `LockGateway`: script-wide transaction lock
- `Clock`: authoritative current time
- `TokenService`: random token generation, hashing, and verification

## Sheet Model

The milestone creates and manages these sheets:

### Services

```text
service_id
name
description
duration_minutes
buffer_before_minutes
buffer_after_minutes
capacity
active
```

`duration_minutes` is required. `capacity` is a positive integer and defaults to `1`.

### Availability

```text
availability_id
service_id
weekday
start_time
end_time
active
```

Multiple windows for the same weekday are allowed. Windows are interpreted in the business timezone.

### AvailabilityExceptions

```text
exception_id
service_id
start_at
end_at
reason
active
```

An empty `service_id` applies to every service. `reason` is business-facing operational text and is never exposed publicly. Creating an exception returns any confirmed bookings it overlaps; it never cancels or hides those bookings automatically.

### Customers

```text
customer_id
name
email
phone
created_at
updated_at
```

Phone is optional. Customers contain no profiles, demographic data, service notes, or sensitive free-form fields.

### Bookings

```text
booking_id
service_id
service_name_snapshot
duration_minutes_snapshot
customer_id
customer_name_snapshot
customer_email_snapshot
customer_phone_snapshot
start_at
end_at
quantity
status
calendar_event_id
manage_token_hash
created_at
updated_at
cancelled_at
completed_at
```

The milestone accepts positive integer quantities. The public UI defaults quantity to `1`; services with capacity greater than one may expose a quantity selector.

### BookingEvents

```text
event_id
booking_id
event_type
actor
timestamp
metadata_json
```

Events are append-only. `metadata_json` uses an allowlist per event type and must not contain management tokens or unnecessary customer data.

### Settings

```text
key
value
```

Settings include business identity, timezone, dedicated booking Calendar ID, zero or more conflict Calendar IDs, authorized dashboard users, booking-window days, minimum notice, slot interval, customer cancellation, customer rescheduling, and email configuration.

Every installation begins with `schema_version = 1`. Startup and setup compare the stored version with the code's current schema version. When the stored version is older, `runMigrations()` applies each intervening migration in order and updates `schema_version` only after that migration succeeds. A stored version newer than the running code fails closed with a clear incompatibility error. Migrations are idempotent and create or add sheets, headers, settings, and indexes without requiring operators to edit storage sheets manually.

## Booking Lifecycle

Milestone states are:

```text
CONFIRMED
CANCELLATION_REQUESTED
RESCHEDULE_REQUESTED
CANCELLED
COMPLETED
NO_SHOW
```

Allowed transitions are explicit:

```text
CONFIRMED -> CANCELLATION_REQUESTED
CONFIRMED -> RESCHEDULE_REQUESTED
CONFIRMED -> CANCELLED
CONFIRMED -> COMPLETED
CONFIRMED -> NO_SHOW
CANCELLATION_REQUESTED -> CONFIRMED
CANCELLATION_REQUESTED -> CANCELLED
RESCHEDULE_REQUESTED -> CONFIRMED
```

`CANCELLATION_REQUESTED` and `RESCHEDULE_REQUESTED` continue consuming capacity. Rejecting a request returns the booking to `CONFIRMED`. A successful reschedule returns the booking to `CONFIRMED` at its new time.

## Availability Calculation

A candidate slot is bookable only when:

```text
service is active
AND duration fits inside a recurring availability window
AND buffers fit inside the availability window
AND start is inside the rolling booking window
AND start satisfies minimum notice
AND requested range does not overlap an active exception
AND requested range does not overlap a configured Calendar conflict
AND service capacity - reserved quantity >= requested quantity
```

Capacity calculations only consider bookings whose occupied interval overlaps the candidate interval. Active scheduled states are `CONFIRMED`, `CANCELLATION_REQUESTED`, and `RESCHEDULE_REQUESTED`. Terminal states do not consume capacity, and the server permits transitions to `COMPLETED` or `NO_SHOW` only after the booking's start time has passed. This prevents an operator from reopening a future slot by prematurely applying a terminal state.

Confirmed booking events are created on a dedicated booking calendar. That calendar is not treated as an external conflict source because Sheets performs authoritative capacity accounting. Configured conflict calendars represent unrelated busy time and block the service's entire capacity for the overlapping interval. If an operator intentionally includes the booking calendar among conflict calendars, the Calendar adapter must ignore event IDs linked to active bookings so one reservation does not incorrectly consume every remaining capacity unit.

Overlap calculations use half-open intervals: `[start, end)`. Buffers expand the interval used for availability and conflict checks but do not change the customer-visible start and end times.

Availability returned to a browser is advisory. Every mutation recomputes availability from authoritative data inside the script lock.

## Create Booking Transaction

1. Validate request shape, service ID, customer fields, timestamps, and quantity.
2. Reject malformed, inactive, past, out-of-window, or insufficient-notice requests.
3. Acquire the script lock with a bounded timeout.
4. Reload service, settings, recurring availability, exceptions, active bookings, and Calendar conflicts.
5. Recalculate the requested slot and remaining capacity.
6. Reject if the slot is no longer bookable.
7. Generate `BKG_`, `CUS_` when necessary, and `EVT_` IDs plus a cryptographically random management token.
8. Create the Google Calendar event.
9. Append the booking and `BOOKING_CREATED` and `BOOKING_CONFIRMED` events.
10. Flush Sheet writes before releasing the lock.
11. Send confirmation email after the durable transaction succeeds.
12. Return the booking summary and plaintext management token once.

If Calendar creation succeeds but a Sheet write fails, the engine attempts to delete the orphaned Calendar event, logs the failure without customer data, and returns `INTERNAL_ERROR`. Email failure does not roll back a confirmed booking; it is recorded as an operational error and may be retried.

## Reschedule Transaction

1. Authenticate the customer token or authorized business user.
2. Validate that the booking can transition from its current state.
3. Acquire the script lock.
4. Reload the booking and all availability inputs.
5. Validate replacement capacity while excluding the booking's own quantity from its original interval.
6. Update the existing Calendar event to the new interval. If the Calendar API cannot update it atomically, create the replacement event first and retain the original until the replacement succeeds.
7. Update the same booking record with the new interval and status `CONFIRMED`.
8. Append `BOOKING_RESCHEDULED` with allowlisted old and new timestamps.
9. Flush Sheet writes and release the lock.
10. Send the reschedule email.

The booking ID and management token remain unchanged. If any validation or Calendar step fails, the original booking remains confirmed at the original interval. If Sheet persistence fails after Calendar mutation, the engine attempts a compensating Calendar rollback and reports `INTERNAL_ERROR`.

## Cancellation

Customer cancellation creates `CANCELLATION_REQUESTED` and appends `CANCELLATION_REQUESTED`. It does not release capacity or remove the Calendar event.

Business approval runs under the script lock, marks the booking `CANCELLED`, cancels or removes the Calendar event, appends `BOOKING_CANCELLED`, releases capacity, and sends the customer notification. Direct business cancellation uses the same operation without the request step.

Repeated approval or cancellation requests are idempotent: the current terminal or pending state is returned without duplicating events or emails.

## API Boundary

### Public operations

```text
listServices
getAvailability
createBooking
getManagedBooking
requestCancellation
requestReschedule
```

### Dashboard operations

```text
listBookings
createManualBooking
rescheduleBooking
cancelBooking
approveCancellation
rejectCancellation
markCompleted
markNoShow
createAvailabilityException
```

Public operations use strict validation, bounded input lengths, per-client throttling, and a honeypot. Responses never expose stack traces, Sheet row numbers, Calendar IDs, token hashes, or customer-existence information.

Dashboard operations are available only through the spreadsheet-bound interface. Each operation requires an active Google identity matching the configured authorized-user allowlist, and authorization is checked server-side on every dashboard read and mutation. If Apps Script cannot provide an active identity, access fails closed.

## Minimal User Interfaces

### Public frontend

The public flow is:

```text
Choose service -> Choose date and slot -> Enter contact details and quantity -> Confirm -> Success
```

The interface handles stale-slot conflicts by returning the customer to availability with an explanation and refreshed results.

### Business dashboard

The spreadsheet-bound dashboard includes:

- Today and upcoming bookings
- Booking detail
- Manual booking creation
- Reschedule
- Direct cancellation
- Cancellation request approval or rejection
- Mark completed or no-show
- Block hours, days, or date ranges

Service and recurring-availability editing may initially use protected human-readable Sheets. A polished web configuration UI belongs to the installation/usability milestone.

## Email

Milestone templates cover:

- Booking confirmation
- Cancellation requested
- Cancellation approved
- Cancellation rejected
- Booking rescheduled

Variables are escaped before insertion. Templates use a fixed allowlist and cannot execute or inject arbitrary HTML.

## Error Contract

Expected errors use stable codes, including:

```text
VALIDATION_ERROR
SERVICE_INACTIVE
SLOT_UNAVAILABLE
INSUFFICIENT_CAPACITY
MINIMUM_NOTICE
BOOKING_WINDOW
INVALID_TOKEN
INVALID_STATE
UNAUTHORIZED
RATE_LIMITED
LOCK_TIMEOUT
INTERNAL_ERROR
```

Messages are safe for public display. Internal diagnostics are logged separately without tokens or unnecessary personal data.

## Testing Strategy

### Unit tests

Pure domain tests cover:

- Multiple recurring windows
- Cross-day and invalid windows
- Availability exceptions
- Booking-window and minimum-notice boundaries
- Business-timezone conversion
- DST transition boundaries, including missing and repeated local times
- Browser timezone differing from the business timezone
- Calendar timezone differing from the business timezone
- Half-open overlap rules
- Service buffers
- Capacity arithmetic and quantities
- All lifecycle transitions
- Token hashing and constant-time comparison where supported
- Rescheduling exclusion and rollback behavior

### Contract tests

Apps Script handlers run against fake Sheet, Calendar, lock, clock, token, and email adapters. Tests cover concurrent stale-slot behavior, idempotent mutations, Calendar failures, Sheet failures, and safe error responses.

### Frontend tests

Retain useful upstream coverage and add:

- Multiple services
- Capacity and quantity display
- Stale-slot recovery
- Validation failures
- Management-token flows
- Customer request flows
- Dashboard mutations

### Manual smoke test

Before milestone acceptance, deploy to a test Apps Script project and verify:

1. Sheet creation and configuration
2. Availability generation
3. Successful booking and Calendar event
4. Concurrent requests cannot exceed capacity
5. Customer cancellation request retains capacity
6. Business approval releases capacity
7. Rescheduling preserves the booking ID and original booking on failure
8. Emails contain working management links
9. Browser, business, and Calendar timezone differences preserve the intended business-local slot
10. A test deployment in a DST-observing timezone handles both spring-forward and fall-back boundaries
11. A schema-version upgrade runs automatically and remains safe when repeated

## Acceptance Criteria

Milestone 1 is complete when:

- A business can configure multiple services and availability in Sheets.
- Customers can see valid slots and create bookings.
- Concurrent confirmation cannot exceed service capacity.
- Confirmed bookings create linked Calendar events and emails.
- Customer management links reveal only the associated booking.
- Cancellation requests do not release capacity before approval.
- Business users can create, reschedule, cancel, complete, and mark no-show bookings.
- Completed and no-show transitions are rejected before the booking start time.
- Availability exceptions report affected bookings without silently altering them.
- Booking lifecycle events are append-only and auditable.
- Schema migrations upgrade older installations without manual Sheet-column edits.
- Automated tests pass and the Google integration smoke test succeeds.
- Upstream MIT attribution is preserved.

