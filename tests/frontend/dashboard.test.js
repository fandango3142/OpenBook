const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '../../backend/Dashboard.html');
const fixtures = () => {
  const today = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(today);
  const tomorrow = new Date(Date.now() + 86400000);
  const tomorrowDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(tomorrow);
  return [
    { booking_id: 'BKG_TODAY', service_id: 'SVC_1', service_name: 'Consultation', customer_name: 'Today Customer', customer_email: 'today@example.com', start_at: `${date}T10:00:00.000Z`, end_at: `${date}T10:30:00.000Z`, quantity: 1, status: 'CONFIRMED' },
    { booking_id: 'BKG_UPCOMING', service_id: 'SVC_1', service_name: 'Consultation', customer_name: 'Upcoming Customer', customer_email: 'upcoming@example.com', start_at: `${tomorrowDate}T10:00:00.000Z`, end_at: `${tomorrowDate}T10:30:00.000Z`, quantity: 1, status: 'CANCELLATION_REQUESTED' },
  ];
};

function setup(overrides = {}) {
  jest.resetModules();
  document.body.innerHTML = '';
  const template = document.createElement('template');
  template.innerHTML = fs.readFileSync(htmlPath, 'utf8');
  document.body.appendChild(template.content.cloneNode(true));
  const bookings = fixtures();
  const calls = [];
  const values = Object.assign({
    listBookings: () => bookings,
    listServices: () => [{ service_id: 'SVC_1', name: 'Consultation', duration_minutes: 30 }],
    getBusinessTimezone: () => 'UTC',
    createManualBooking: command => ({ booking: { booking_id: 'BKG_MANUAL', service_id: command.service_id, service_name: 'Consultation', customer_name: command.customer.name, customer_email: command.customer.email, start_at: command.start_at, end_at: command.start_at, quantity: command.quantity, status: 'CONFIRMED' } }),
    rescheduleBooking: id => ({ booking_id: id, status: 'CONFIRMED' }),
    cancelBooking: id => ({ booking_id: id, status: 'CANCELLED' }),
    approveCancellation: id => ({ booking_id: id, status: 'CANCELLED' }),
    rejectCancellation: id => ({ booking_id: id, status: 'CONFIRMED' }),
    markCompleted: id => ({ booking_id: id, status: 'COMPLETED' }),
    markNoShow: id => ({ booking_id: id, status: 'NO_SHOW' }),
    createAvailabilityException: exception => ({ exception, affected_bookings: [] }),
  }, overrides);
  const runner = {
    success: null,
    failure: null,
    withSuccessHandler(fn) { this.success = fn; return this; },
    withFailureHandler(fn) { this.failure = fn; return this; },
  };
  Object.keys(values).forEach(method => {
    runner[method] = jest.fn((...args) => {
      calls.push([method, ...args]);
      try { runner.success(values[method](...args)); }
      catch (error) { runner.failure(error); }
    });
  });
  global.google = { script: { run: runner } };
  const script = Array.from(template.content.querySelectorAll('script')).map(node => node.textContent).join('\n');
  window.eval(script);
  return { calls, runner, bookings, app: window.OpenBookDashboard };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Spreadsheet-bound business dashboard', () => {
  test('renders today and upcoming bookings in business timezone', async () => {
    const { app } = setup();
    await app.init();
    expect(document.querySelector('#today-bookings').textContent).toContain('Today Customer');
    expect(document.querySelector('#upcoming-bookings').textContent).toContain('Upcoming Customer');
  });

  test('shows booking details and only controls valid for its current status', async () => {
    const { app } = setup();
    await app.init();
    document.querySelector('[data-booking-id="BKG_UPCOMING"]').click();
    expect(document.querySelector('#booking-detail').textContent).toContain('upcoming@example.com');
    expect(document.querySelector('[data-action="approve-cancellation"]')).not.toBeNull();
    expect(document.querySelector('[data-action="reject-cancellation"]')).not.toBeNull();
  });

  test('manual booking submits through the shared authorized API wrapper', async () => {
    const { app, runner } = setup();
    await app.init();
    document.getElementById('manual-service').value = 'SVC_1';
    document.getElementById('manual-start').value = '2030-01-01T10:00';
    document.getElementById('manual-name').value = 'Jane Doe';
    document.getElementById('manual-email').value = 'jane@example.com';
    document.getElementById('manual-quantity').value = '2';
    document.getElementById('manual-booking-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(runner.createManualBooking).toHaveBeenCalledWith({ service_id: 'SVC_1', start_at: expect.stringMatching(/^2030-01-01T10:00:00/), quantity: 2, customer: { name: 'Jane Doe', email: 'jane@example.com', phone: '' } });
  });

  test('rescheduling submits the replacement instant through the authorized RPC', async () => {
    const row = Object.assign({}, fixtures()[0], { start_at: '2030-01-01T10:00:00.000Z', end_at: '2030-01-01T10:30:00.000Z' });
    const { app, runner } = setup({ listBookings: () => [row] });
    await app.init();
    document.querySelector('[data-booking-id="' + row.booking_id + '"]').click();
    document.querySelector('[data-action="open-reschedule"]').click();
    document.getElementById('reschedule-start').value = '2030-01-01T12:00';
    document.getElementById('reschedule-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(runner.rescheduleBooking).toHaveBeenCalledWith('BKG_TODAY', { start_at: expect.stringMatching(/^2030-01-01T12:00:00/) });
  });

  test.each([
    ['direct cancellation', 'CONFIRMED', 'cancel-booking', 'cancelBooking'],
    ['cancellation approval', 'CANCELLATION_REQUESTED', 'approve-cancellation', 'approveCancellation'],
    ['cancellation rejection', 'CANCELLATION_REQUESTED', 'reject-cancellation', 'rejectCancellation'],
  ])('%s delegates to its authorized RPC', async (_label, status, action, method) => {
    const row = Object.assign({}, fixtures()[0], { status });
    const { app, runner } = setup({ listBookings: () => [row] });
    await app.init();
    document.querySelector('[data-booking-id="' + row.booking_id + '"]').click();
    document.querySelector(`[data-action="${action}"]`).click();
    await settle();
    expect(runner[method]).toHaveBeenCalledWith(row.booking_id);
  });

  test('terminal booking state does not show further lifecycle controls', async () => {
    const today = fixtures()[0].start_at;
    const done = { booking_id: 'BKG_DONE', service_id: 'SVC_1', service_name: 'Consultation', customer_name: 'Done', start_at: today, end_at: '2030-01-01T10:30:00Z', quantity: 1, status: 'COMPLETED' };
    const { app } = setup({ listBookings: () => [done] });
    await app.init();
    document.querySelector('[data-booking-id="BKG_DONE"]').click();
    expect(document.querySelector('#booking-detail [data-action]')).toBeNull();
  });

  test('time blocking calls the authorized exception operation and reports overlaps', async () => {
    const { app, runner } = setup({ createAvailabilityException: exception => ({ exception, affected_bookings: [{ booking_id: 'BKG_TODAY' }] }) });
    await app.init();
    document.getElementById('exception-service').value = 'SVC_1';
    document.getElementById('exception-start').value = '2030-01-01T10:00';
    document.getElementById('exception-end').value = '2030-01-01T11:00';
    document.getElementById('exception-reason').value = 'Staff unavailable';
    document.getElementById('exception-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(runner.createAvailabilityException).toHaveBeenCalledWith({ service_id: 'SVC_1', start_at: expect.any(String), end_at: expect.any(String), reason: 'Staff unavailable' });
    expect(document.getElementById('exception-result').textContent).toContain('BKG_TODAY');
  });

  test('date-time fields are interpreted in the configured business timezone', async () => {
    const { app } = setup({ getBusinessTimezone: () => 'Asia/Kolkata' });
    await app.init();
    expect(app.toBusinessInstant('2030-01-01T10:00')).toBe('2030-01-01T04:30:00.000Z');
  });

  test('rejects nonexistent and ambiguous DST wall-clock times', async () => {
    const { app } = setup({ getBusinessTimezone: () => 'America/New_York' });
    await app.init();
    expect(() => app.toBusinessInstant('2026-03-08T02:30')).toThrow(/does not exist/);
    expect(() => app.toBusinessInstant('2026-11-01T01:30')).toThrow(/ambiguous/);
  });
});
