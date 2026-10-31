const ConfigLoader = require('../../js/config-loader');
const fs = require('fs');
const path = require('path');

beforeEach(() => {
  ConfigLoader.resetConfig();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    text: () => Promise.resolve('apps_script_url: "https://example.test/exec"\nbrand_name: "OpenBook"\ndefault_timezone: "Asia/Kolkata"'),
  });
  global.jsyaml = { load: (text) => Object.fromEntries(text.split('\n').map((line) => {
    const index = line.indexOf(':');
    return [line.slice(0, index), line.slice(index + 1).trim().replace(/^"|"$/g, '')];
  })) };
});

test('loads only neutral site settings and services from listServices API', async () => {
  global.ApiClient = { init: jest.fn(), listServices: jest.fn().mockResolvedValue({ services: [
    { service_id: 'consult', name: 'Consultation', description: 'Talk', duration_minutes: 30, capacity: 3 },
  ] }) };
  const config = await ConfigLoader.loadAll();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toContain('settings.yaml');
  expect(global.ApiClient.listServices).toHaveBeenCalledTimes(1);
  expect(config.services[0].service_id).toBe('consult');
  expect(config.settings.default_timezone).toBe('Asia/Kolkata');
  expect(config.locations).toBeUndefined();
});

test('rejects invalid service entries returned by the API', async () => {
  global.ApiClient = { init: jest.fn(), listServices: jest.fn().mockResolvedValue({ services: [
    { service_id: '', name: 'broken' },
  ] }) };
  await expect(ConfigLoader.loadAll()).rejects.toThrow('No bookable services');
});

test('checked-in configuration never targets the upstream live Apps Script deployment', () => {
  const settings = fs.readFileSync(path.join(__dirname, '../../config/settings.yaml'), 'utf8');
  expect(settings).toContain('YOUR_DEPLOYED_APPS_SCRIPT_WEB_APP_URL');
  expect(settings).not.toContain('AKfycbxcBySOIJq1f2SP7oVTr3JgBc91qTxdFaQKknnoe8VdLJDxijKV-gGdFb9mNHdJLMMN');
});
