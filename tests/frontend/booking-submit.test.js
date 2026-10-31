function flush() { return new Promise((resolve) => setTimeout(resolve, 0)); }
const fs = require('fs');
const path = require('path');

function setupDOM() {
  document.body.textContent = '';
  for (let i = 1; i <= 5; i++) {
    const section = document.createElement('section'); section.id = `step-${i}`; section.className = 'step-content';
    if (i === 5) section.setAttribute('aria-labelledby', 'confirmation-heading');
    if (i === 5) { const content = document.createElement('div'); content.id = 'confirmation-content'; section.appendChild(content); }
    document.body.appendChild(section);
  }
  const indicator = document.createElement('div'); indicator.className = 'step-indicator';
  for (let i = 1; i <= 5; i++) { const el = document.createElement('span'); el.className = 'step'; el.dataset.step = i; indicator.appendChild(el); }
  document.body.appendChild(indicator);
    ['loading', 'error-banner', 'services', 'selected-service-info', 'selected-slot-info', 'review-summary', 'booking-form', 'name', 'email', 'phone', 'quantity', 'hp', 'place-booking', 'back-to-services', 'back-to-slots', 'calendar-container'].forEach((id) => {
    const el = id === 'booking-form' ? document.createElement('form') : id === 'name' || id === 'email' || id === 'phone' || id === 'quantity' || id === 'hp' ? document.createElement('input') : document.createElement('div');
    el.id = id; document.body.appendChild(el);
  });
}

describe('public booking payload and stale availability', () => {
  let App;
  let selected;
  beforeEach(async () => {
    jest.resetModules(); setupDOM(); selected = null;
    const config = { settings: { apps_script_url: 'https://example.test/exec', default_timezone: 'UTC', business_timezone: 'UTC' }, services: [
      { service_id: 'consult', name: 'Consult', description: 'Talk', duration_minutes: 30, capacity: 3 },
    ] };
    global.ConfigLoader = { loadAll: () => Promise.resolve(config), getConfig: () => config };
    global.TimezoneUtil = { detect: () => {}, getBusinessTimezone: () => 'UTC', formatInTimezone: (instant) => instant,
      getBrowserTimezone: () => 'UTC' };
    global.ApiClient = { init: () => {}, listServices: () => Promise.resolve({ services: config.services }),
      createBooking: jest.fn().mockResolvedValue({ booking: { booking_id: 'b1', start_at: '2030-01-01T10:00:00Z', end_at: '2030-01-01T10:30:00Z' } }),
      invalidatePrefetch: jest.fn() };
    global.CalendarUI = { init: (_service, cb) => { selected = cb; }, refresh: jest.fn() };
    global.BookingForm = { init: () => {}, setCapacity: jest.fn(), extractFormData: () => ({ name: 'Jane Doe', email: 'jane@example.com', phone: '', quantity: 2, hp: '' }) };
    App = require('../../js/app');
    await flush();
    document.querySelector('.service-card').click();
    selected({ start_at: '2030-01-01T10:00:00.000Z', end_at: '2030-01-01T10:30:00.000Z', remaining_capacity: 3 });
  });

  test('submits service ID, exact slot instant, quantity, nested customer, and honeypot only', () => {
    App.submitBooking(global.BookingForm.extractFormData());
    expect(global.ApiClient.createBooking).toHaveBeenCalledWith({
      service_id: 'consult', start_at: '2030-01-01T10:00:00.000Z', quantity: 2,
      customer: { name: 'Jane Doe', email: 'jane@example.com', phone: '' }, hp: '',
    });
  });

  test('successful confirmation has the heading referenced by its section label', async () => {
    App.submitBooking(global.BookingForm.extractFormData()); await flush();
    const section = document.getElementById('step-5');
    const heading = document.querySelector('#confirmation-content h2');
    expect(heading.id).toBe('confirmation-heading');
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
  });

  test('production confirmation content container is inside the labeled step', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    const template = document.createElement('template'); template.innerHTML = html;
    const section = template.content.querySelector('#step-5');
    expect(section.querySelector('#confirmation-content')).not.toBeNull();
  });

  test.each(['SLOT_UNAVAILABLE', 'INSUFFICIENT_CAPACITY'])('%s returns to slot selection and refreshes fresh availability', async (code) => {
    const err = Object.assign(new Error(code), { code });
    global.ApiClient.createBooking.mockRejectedValue(err);
    App.submitBooking(global.BookingForm.extractFormData()); await flush();
    expect(global.ApiClient.invalidatePrefetch).toHaveBeenCalled();
    expect(global.CalendarUI.refresh).toHaveBeenCalled();
    expect(document.getElementById('step-2').classList.contains('active')).toBe(true);
    expect(document.getElementById('error-banner').textContent).not.toContain('undefined');
  });
});
