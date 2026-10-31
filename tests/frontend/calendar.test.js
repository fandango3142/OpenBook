const CalendarUI = require('../../js/calendar');

beforeEach(() => {
  document.body.textContent = '';
  const container = document.createElement('div'); container.id = 'calendar-container'; document.body.appendChild(container);
  global.App = { showError: jest.fn() };
  global.ApiClient = { getAvailability: jest.fn().mockResolvedValue({ slots: [
    { start_at: '2030-01-01T10:00:00Z', end_at: '2030-01-01T10:30:00Z', remaining_capacity: 1 },
    { start_at: '2030-01-01T11:00:00Z', end_at: '2030-01-01T11:30:00Z', remaining_capacity: 3 },
  ] }) };
  global.TimezoneUtil = { formatInTimezone: (instant) => `Business ${instant}`, getBrowserTimezone: () => 'UTC' };
  global.ConfigLoader = { getConfig: () => ({ settings: { business_timezone: 'UTC' } }) };
});

test('shows remaining capacity only when more than one place remains and passes API slot instant unchanged', async () => {
  let chosen;
  CalendarUI.init({ service_id: 'consult', duration_minutes: 30, capacity: 4 }, (slot) => { chosen = slot; });
  await Promise.resolve(); await Promise.resolve();
  const cards = document.querySelectorAll('.available-slot');
  expect(cards).toHaveLength(2);
  expect(cards[0].textContent).not.toContain('place');
  expect(cards[1].textContent).toContain('3 places remaining');
  cards[0].click();
  expect(chosen.start_at).toBe('2030-01-01T10:00:00Z');
});
