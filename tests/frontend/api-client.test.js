const ApiClient = require('../../js/api-client');

beforeEach(() => {
  ApiClient.init('https://example.test/exec');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true, services: [], slots: [] }) });
});

test('requests the public services action and includes a stable client ID', async () => {
  await ApiClient.listServices();
  const request = JSON.parse(fetch.mock.calls[0][1].body);
  expect(request.action).toBe('listServices');
  expect(request.clientId).toEqual(expect.any(String));
});

test('availability always fetches fresh results with the service interval and quantity', async () => {
  const input = { service_id: 'class', start_at: '2030-01-01T00:00:00Z', end_at: '2030-01-08T00:00:00Z', quantity: 2 };
  await ApiClient.getAvailability(input);
  const request = JSON.parse(fetch.mock.calls[0][1].body);
  expect(request).toMatchObject({ action: 'getAvailability', ...input });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('booking errors preserve stable server error codes for stale-slot recovery', async () => {
  global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: false, error: 'INSUFFICIENT_CAPACITY' }) });
  await expect(ApiClient.createBooking({})).rejects.toMatchObject({ code: 'INSUFFICIENT_CAPACITY' });
});

test('refuses the unconfigured placeholder endpoint before any network request', async () => {
  ApiClient.init('YOUR_DEPLOYED_APPS_SCRIPT_WEB_APP_URL');
  await expect(ApiClient.listServices()).rejects.toThrow('not configured');
  expect(fetch).not.toHaveBeenCalled();
});
