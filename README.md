# OpenBook

OpenBook is a capacity-safe booking engine built on Google Apps Script and Google Sheets. Its first milestone establishes reliable booking, cancellation, rescheduling, and administrative workflows for a single configured calendar.

The approved milestone one design is documented in [the booking engine spec](docs/superpowers/specs/2026-10-02-booking-engine-design.md), with the implementation sequence in [the plan](docs/superpowers/plans/2026-10-02-booking-engine-m1.md).

## Development

Install the pinned frontend test dependencies and run the full upstream baseline suite:

```bash
npm ci --prefix tests/frontend
npm test
```

The test command runs the backend Node tests followed by the frontend Jest tests.

## Attribution

This repository began from [ContextLab/scheduler](https://github.com/ContextLab/scheduler). See [UPSTREAM.md](UPSTREAM.md) for the pinned revision and attribution details.
