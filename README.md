# OpenBook

Milestone 1 is intended to build a capacity-safe booking engine on Google Apps Script and Google Sheets, with reliable booking, cancellation, rescheduling, and administrative workflows.

The approved milestone one design is documented in [the booking engine spec](docs/superpowers/specs/2026-10-02-booking-engine-design.md), with the implementation sequence in [the plan](docs/superpowers/plans/2026-10-02-booking-engine-m1.md).

## Development

Install the pinned frontend test dependencies and run the upstream baseline checks:

```bash
npm ci --prefix tests/frontend
npm test
```

The root `npm test` command runs the backend Node tests followed by the frontend Jest tests. The imported upstream baseline currently has four failing reconciliation assertions, so this command stops before Jest. To run the frontend suite separately:

```bash
npm --prefix tests/frontend test -- --runInBand
```

That frontend command currently passes all 69 tests.

## Attribution

This repository began from [ContextLab/scheduler](https://github.com/ContextLab/scheduler). See [UPSTREAM.md](UPSTREAM.md) for the pinned revision and attribution details.
