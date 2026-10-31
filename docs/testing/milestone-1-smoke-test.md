# Milestone 1 disposable-account smoke test

This procedure verifies the Apps Script deployment and Google service boundaries that Node/Jest tests cannot exercise. **Use only the disposable spreadsheet and test Calendars configured in [the Sheet setup guide](../configuration/sheets.md). Do not run this procedure or `runBookingSmokeTest()` against production.** Never use a real customer's contact data.

## Record the test environment

Before each run, record:

| Field | Value |
| --- | --- |
| Test date/time (include UTC offset) | |
| Git commit | |
| Apps Script deployment version | |
| Web app URL (test deployment only) | |
| Spreadsheet ID (test only) | |
| Business timezone from `Settings.business_timezone` | |
| Booking Calendar timezone | |
| Conflict Calendar timezone | |
| Browser timezone | |
| DST zone used for boundary verification (for example `America/New_York`) | |
| Test operator account | |

Use `Asia/Kolkata` for the base fixture, then run the timezone boundary checks with an isolated test fixture configured for a DST-observing zone such as `America/New_York`. Keep the Apps Script project timezone at UTC. The recorded business, Calendar, and browser timezones should intentionally differ in at least one test.

## Prepare and deploy

1. Follow the configuration guide and verify the test Sheet, booking Calendar, and conflict Calendar are disposable and isolated.
2. In Apps Script, run `runMigrations()` and confirm `Settings.schema_version` is `1`. Open the Sheet and confirm the **OpenBook** menu appears. From **OpenBook → Run setup / migrations**, confirm the version remains `1`.
3. Run `testCalendarSmokeConfiguration()` and confirm it passes. It checks Calendar access and reads conflict metadata; it does not create an event.
4. Run `testEmailService()` and confirm the lifecycle email interface and quota check pass. This helper does not send email.
5. Deploy a new test web-app version with the repository's manifest permissions. Use only the disposable Sheet and Calendars. Record the deployment version and test URL; do not edit or replace a production deployment.
6. Point a local/test static frontend at that test URL. Use a test inbox you control for any message-delivery checks; no messages should be sent to real customers.

## Automated transactional smoke helper

1. Reconfirm the Settings row `smoke_test_mode` is exactly `true` and customer cancellation is enabled.
2. Run `runBookingSmokeTest()` from the Apps Script editor. It temporarily suppresses lifecycle email sends, creates a uniquely tagged `OBSMOKE_…` Service, recurring windows, Customer, bookings, events, and lifecycle events, then removes only rows associated with that unique generated test identity and its exact booking event IDs.
3. Confirm the returned result has `passed: true` and each step is true: schema setup, slot generation, booking/event creation, capacity rejection, cancellation-request capacity retention, approval capacity release, and reschedule ID preservation.
4. Confirm the generated test Service, Availability, Customer, Booking, BookingEvent, and Calendar event records were removed. The helper never logs or returns a management token.
5. If cleanup fails, stop and use the returned `manual_recovery_ids` and log line to remove only the named test records/events from the disposable assets. Do not rerun until cleanup is complete. A cleanup failure is a failed smoke test.

The helper uses a random invalid-domain email and suppresses `EmailService` calls during its transaction checks, so it does not intentionally deliver email. It needs at least two future slots in the booking window and the configured test booking Calendar.

## Public booking and lifecycle walkthrough

Use only the test Service and a test inbox you control. Keep the browser developer console/network panel open so API status and UTC instants can be compared with the displayed local times.

| Check | Action and expected result | Pass / fail / notes |
| --- | --- | --- |
| Service loading | Open the public test page. The active `M1 Test Session` comes from `listServices`; no legacy free-form purpose/notes controls are shown. | |
| Slot generation | Select the Service and a future window. Slots are inside the recurring window and outside the configured exception. | |
| Calendar conflict | Add a temporary busy event to the dedicated conflict Calendar overlapping a future slot. Refresh availability; that slot disappears. Delete only the temporary test event afterward. | |
| Capacity | With capacity `3`, create reservations totaling three seats in one interval; the next seat is rejected as unavailable. | |
| Confirmation | Create a single test booking. It returns a generated booking ID and one-time management token; a confirmed event appears only on the dedicated booking Calendar. The Sheet stores only the token hash. | |
| Customer cancellation request | Request cancellation using the management link. The status becomes `CANCELLATION_REQUESTED`; the interval remains full and cannot be overbooked. | |
| Approval | Approve the request from the spreadsheet dashboard. The booking becomes terminal, the linked test Calendar event is removed, and its capacity is released. | |
| Rejection | For a separate test booking, reject the cancellation request. It returns to `CONFIRMED`, keeps the same ID/event, and continues to occupy capacity. | |
| Reschedule request | Submit a customer reschedule request. The original interval and booking ID remain until the operator acts. | |
| Reschedule approval | Move the booking in the dashboard to a free slot. The booking ID and linked Calendar event ID remain stable; the event time and Sheet interval change together. | |
| Direct cancellation | Cancel a separate confirmed test booking from the dashboard. The status, event deletion, audit event, and released capacity agree. | |
| Manual booking | Create a booking from the dashboard and confirm it uses the same capacity checks and durable booking flow as the public page. | |
| Completion guard | Attempt to mark a future booking completed or no-show; the action is rejected. After the start time, verify the permitted terminal action on a disposable test booking. | |
| Privacy and recovery | Check Sheets, Calendar event descriptions, logs, and response payloads: no purpose/notes or plaintext token is persisted/logged. Confirm failed writes leave recoverable state and no duplicate booking. | |

Use separate disposable bookings for each state path. Do not reuse or delete existing customer records to set up a test. After the walkthrough, delete only the bookings/events and fixture rows created during this test.

## Timezone and DST boundary checks

Run these against a separate disposable fixture configured for `America/New_York`; keep the project timezone at UTC and use a browser timezone different from the business timezone.

- Verify a normal local slot is displayed in business time and, where the browser differs, the browser-local companion is clearly identified. The submitted `start_at` remains the server-returned UTC instant.
- On the spring-forward date, a recurring window boundary inside the nonexistent local-time gap must not produce a slot.
- On the fall-back date, a repeated local time must be skipped unless the request explicitly selects the earlier/later occurrence; the two occurrences must map to distinct UTC instants.
- Set the test booking Calendar to a timezone different from the business timezone. Confirm conflict events are compared by instant, not by their wall-clock string.
- Record the exact DST dates, zone, browser/Calendar zones, input local time, returned UTC instant, and result in the environment table and checklist notes.

## Completion record

Attach or link the checklist and test-only screenshots/log excerpts to the release notes. Do not include management tokens, customer data, or Calendar event descriptions. A missing deployment, skipped live check, failed cleanup, or unchecked acceptance row means the live smoke test is **pending**, and M1 must not be described as fully verified.
