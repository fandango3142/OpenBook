<p align="center">
  <img src="openbook-mark.svg" width="88" alt="OpenBook logo">
</p>

<h1 align="center">OpenBook</h1>

<p align="center"><strong>A little more space for the work you do.</strong><br>
An open-source booking engine built with Google Apps Script, Sheets, Calendar, and email.</p>

<p align="center">
  <a href="https://fandango3142.github.io/OpenBook/site/">OpenBook landing page</a> ·
  <a href="#release-overview">Product overview</a> ·
  <a href="#setup-and-test-status">Setup and test docs</a> ·
  <a href="https://github.com/fandango3142/OpenBook/issues/new">Get help</a>
</p>

---

## Release overview

OpenBook gives independent businesses a straightforward way to accept appointment bookings. Customers choose an available service and time, then receive an email confirmation with a management link. Operators can add bookings and review later cancellation or reschedule requests.

This repository describes the current M1 implementation. Automated backend and frontend checks are available. A live Apps Script deployment and disposable-account smoke test are separate operator-run acceptance steps; passing local tests alone does not verify Google permissions, Calendar configuration, or deployment.

> **Setup status:** The current setup instructions are for technical testing with disposable Google assets. There is not yet a verified non-technical production setup procedure.

## What’s included

- **Customer booking:** Service-aware availability and booking submission, with immediate confirmation for new bookings.
- **Booking records:** Google Sheets is the authoritative record for booking state and capacity.
- **Calendar coordination:** Calendar events are checked for conflicts and created for confirmed bookings.
- **Customer email:** Confirmation includes booking details and a management link.
- **Operator workflows:** Manual booking support and review of later cancellation and reschedule requests.
- **Project documentation:** Current disposable test setup instructions, a smoke-test checklist, and the M1 design and implementation plan.

This README is the GitHub project landing page. It summarizes the current product and points to the maintained setup and verification documentation below.

## Setup and test status

The current setup procedure is intended for developers validating the project, not for connecting a live business. Use a separate disposable Sheet, dedicated test Calendars, and a test inbox. Review the source and the permissions Google requests before authorizing anything. Do not use customer records or production calendars for the test walkthrough.

- [Disposable Sheet configuration](docs/configuration/sheets.md)
- [M1 smoke-test checklist](docs/testing/milestone-1-smoke-test.md)
- [Booking-engine design](docs/superpowers/specs/2026-10-02-booking-engine-design.md)
- [M1 implementation plan](docs/superpowers/plans/2026-10-02-booking-engine-m1.md)

The generated-ID booking smoke helper refuses to run unless `smoke_test_mode` is explicitly enabled in the test spreadsheet.

## Run the checks

Install the pinned frontend test dependencies and run all automated suites:

```bash
npm ci --prefix tests/frontend
npm test
```

The root test command runs backend Node tests followed by frontend Jest tests. Run the frontend suite by itself with:

```bash
npm --prefix tests/frontend test -- --runInBand --cacheDirectory node_modules/.cache/jest
```

To import the Apps Script project, configure its Script Properties and Sheet tabs using the [disposable configuration guide](docs/configuration/sheets.md). The Apps Script project timezone is pinned to UTC; business availability and customer-facing times use the Sheet’s `business_timezone` value.

## Known limitations and service terms

- The documented setup is technical and test-only; a verified production onboarding path is not available yet.
- Google quotas, availability, terms, and any charges depend on Google and the owner’s account and region. They are outside OpenBook’s control; no fixed or zero-cost Google service is promised.
- GitHub Issues are public. Do not include customer details, credentials, account data, or private booking links when [asking for help](https://github.com/fandango3142/OpenBook/issues/new).

## License and attribution

OpenBook is distributed under the [MIT License](LICENSE). This repository began from [ContextLab/scheduler](https://github.com/ContextLab/scheduler); see [UPSTREAM.md](UPSTREAM.md) for the pinned revision and attribution details.
