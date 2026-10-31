# OpenBook

OpenBook is an open-source, capacity-aware booking engine built on Google Apps Script, Google Sheets, and Google Calendar. The M1 implementation supports public booking, customer cancellation/reschedule requests, operator decisions, manual bookings, and an operational dashboard. The Sheet is authoritative for booking state and capacity; Calendar supplies conflicts and receives confirmed booking events.

The approved milestone one design is documented in [the booking engine spec](docs/superpowers/specs/2026-10-02-booking-engine-design.md), with the implementation sequence in [the plan](docs/superpowers/plans/2026-10-02-booking-engine-m1.md).

## Status

Automated backend and frontend checks are available with `npm test`. A live Apps Script deployment and disposable-Google-account smoke test are still operator-run acceptance steps; do not treat passing local tests as proof that Google permissions, Calendar configuration, or deployment work. Follow the [M1 smoke-test guide](docs/testing/milestone-1-smoke-test.md) and use only the [disposable Sheet configuration](docs/configuration/sheets.md). The generated-ID booking smoke helper refuses to run unless `smoke_test_mode` is explicitly enabled in the test spreadsheet.

## Development

Install the pinned frontend test dependencies and run the test suites:

```bash
npm ci --prefix tests/frontend
npm test
```

The root `npm test` command runs the backend Node tests followed by the frontend Jest tests. To run the frontend suite separately:

```bash
npm --prefix tests/frontend test -- --runInBand --cacheDirectory node_modules/.cache/jest
```

To import the Apps Script project, configure its Script Properties and the Sheet tabs described in the [configuration guide](docs/configuration/sheets.md). The Apps Script project timezone is pinned to UTC; all business availability and customer-facing times are interpreted using the Sheet's `business_timezone` value.

## Attribution

This repository began from [ContextLab/scheduler](https://github.com/ContextLab/scheduler). See [UPSTREAM.md](UPSTREAM.md) for the pinned revision and attribution details.
