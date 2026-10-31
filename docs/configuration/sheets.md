# Disposable M1 test spreadsheet configuration

This guide configures a **disposable test spreadsheet** for Milestone 1 verification. Do not use a production spreadsheet, production booking Calendar, or a Calendar containing real customer data. The Apps Script smoke helper creates temporary records and Calendar events; it deletes only records tied to its generated `OBSMOKE_…` run identity, and prints recovery IDs if cleanup fails.

## 1. Create isolated Google test assets

Create a new, empty Google Sheet and two dedicated test Calendars:

- `OpenBook M1 Test Bookings` — the only Calendar where OpenBook may create test booking events.
- `OpenBook M1 Test Conflicts` — an empty Calendar used only as a conflict source. Add one disposable event during the conflict-check step in the smoke-test guide.

Set both test Calendars to `America/New_York` while the base test business timezone remains `Asia/Kolkata`; this deliberately exercises differing Calendar/business zones. Record the actual values in the smoke-test run sheet. For DST checks, use a separate fixture with a DST-observing business timezone.

Copy the spreadsheet ID and the two Calendar IDs from their URLs/settings. Do not substitute IDs from a production resource. Bind a new Apps Script project to the test spreadsheet, then copy the contents of `backend/` into that project. Enable the Calendar Advanced Service (v3) in Apps Script and its associated Google Cloud project. Set these Script Properties:

| Property | Test value |
| --- | --- |
| `SPREADSHEET_ID` | ID of the disposable Sheet |
| `GITHUB_PAGES_URL` | URL of the deployed static test frontend, or blank while testing backend only |

The project timezone is `Etc/UTC`. Availability conversion must use the Sheet's `business_timezone`; do not change the business timezone merely to match the browser, script, or Calendar timezone.

## 2. Create schema and configure Settings

Run `runMigrations()` from the Apps Script editor, or open the bound Sheet and select **OpenBook → Run setup / migrations**. This creates the versioned `Settings`, `Services`, `Availability`, `AvailabilityExceptions`, `Customers`, `Bookings`, and `BookingEvents` tabs. The first row of each tab is its schema header; do not rename columns or reorder them.

On the `Settings` tab, use `key` and `value` columns and add these rows (replace the two Calendar placeholders with IDs of the dedicated test Calendars):

| key | value |
| --- | --- |
| `schema_version` | `1` (written by migrations) |
| `business_name` | `OpenBook M1 Test` |
| `business_timezone` | `Asia/Kolkata` |
| `booking_calendar_id` | `TEST_BOOKING_CALENDAR_ID` |
| `conflict_calendar_ids` | `["TEST_CONFLICT_CALENDAR_ID"]` |
| `authorized_dashboard_users` | `["dukedsa8@gmail.com"]` |
| `booking_window_days` | `90` |
| `minimum_notice_hours` | `12` |
| `slot_interval_minutes` | `30` |
| `customer_cancellation_enabled` | `true` |
| `customer_rescheduling_enabled` | `true` |
| `smoke_test_mode` | `true` |

The `conflict_calendar_ids` cell must contain valid JSON. It can contain one or more dedicated test Calendar IDs; do not include the production Calendar. `authorized_dashboard_users` is also JSON and grants the dashboard to the listed Google account only. The smoke test requires customer cancellation to be enabled because it verifies that a request retains capacity until an operator approves it.

## 3. Add one capacity-three Service and two recurring windows

In `Services`, add one active test Service. Leave `buffer_before_minutes` and `buffer_after_minutes` at zero for this fixture.

| service_id | name | description | duration_minutes | buffer_before_minutes | buffer_after_minutes | capacity | active |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| `SRV_M1_TEST` | `M1 Test Session` | `Disposable verification service` | `30` | `0` | `0` | `3` | `TRUE` |

In `Availability`, add two recurring windows for that service. This schedule intentionally leaves a gap between windows for testing containment.

| availability_id | service_id | weekday | start_time | end_time | active |
| --- | --- | --- | --- | --- | --- |
| `AVL_M1_AM` | `SRV_M1_TEST` | `Monday` | `09:00` | `12:00` | `TRUE` |
| `AVL_M1_PM` | `SRV_M1_TEST` | `Monday` | `13:00` | `17:00` | `TRUE` |

Repeat those two rows for the weekdays you want to exercise, using unique `availability_id` values. Weekday and time values are interpreted in `business_timezone`.

## 4. Add one blocking exception

Add one active, future exception to `AvailabilityExceptions`. The example below is a one-time block on the test Service; adjust it to a future interval in the configured booking horizon if needed.

| exception_id | service_id | start_at | end_at | reason | active |
| --- | --- | --- | --- | --- | --- |
| `EXC_M1_TEST` | `SRV_M1_TEST` | `2026-11-09T06:30:00.000Z` | `2026-11-09T07:00:00.000Z` | `Disposable smoke-test block` | `TRUE` |

The exception interval is stored as an instant. The reason is operator-only and must not contain customer details.

## 5. Final isolation check

Before deployment, confirm all of the following:

- The spreadsheet is new and contains no production or customer records.
- Both Calendar IDs are dedicated test Calendars; the booking and conflict calendars are not production calendars.
- `smoke_test_mode` is exactly `true`, and the smoke helper will be run only on this disposable spreadsheet.
- `authorized_dashboard_users` contains only the intended test operator.
- The Apps Script project has only the test Sheet ID and test Calendar IDs configured.

After verification, remove the test deployment and disposable Google assets when no longer needed. Never copy live customer data into the fixture.
