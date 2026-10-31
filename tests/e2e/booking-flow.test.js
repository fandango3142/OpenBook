/**
 * Read-only preflight for a deployed M1 endpoint. Full create/cancel/reschedule
 * checks belong to docs/testing/milestone-1-smoke-test.md and the Apps Script
 * runBookingSmokeTest() helper on a disposable spreadsheet.
 *
 * Usage (test deployment only):
 *   $env:APPS_SCRIPT_URL = 'https://script.google.com/macros/s/TEST_DEPLOYMENT/exec'
 *   node tests/e2e/booking-flow.test.js
 */

const endpoint = process.env.APPS_SCRIPT_URL;
const requestedServiceId = process.env.SERVICE_ID;

if (!endpoint || endpoint === 'PLACEHOLDER_APPS_SCRIPT_URL') {
  console.error('Set APPS_SCRIPT_URL to a disposable M1 test deployment. This preflight does not create bookings.');
  process.exit(1);
}

async function apiCall(action, payload) {
  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action }, payload || {})),
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

async function main() {
  const listed = await apiCall('listServices');
  if (!listed.success || !Array.isArray(listed.services)) throw new Error('listServices failed');
  if (!listed.services.length) throw new Error('No active test Services are configured');
  const service = requestedServiceId
    ? listed.services.find(item => item.service_id === requestedServiceId)
    : listed.services[0];
  if (!service) throw new Error('SERVICE_ID is not active in this test deployment');

  const start = new Date(Date.now() + 36 * 60 * 60 * 1000);
  const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const available = await apiCall('getAvailability', {
    service_id: service.service_id,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    quantity: 1,
  });
  if (!available.success || !Array.isArray(available.slots)) throw new Error('getAvailability failed');

  console.log('PASS: M1 service and availability endpoints responded.');
  console.log('Service ID:', service.service_id);
  console.log('Available test slots in requested range:', available.slots.length);
  console.log('Read-only preflight only; no booking or email was created.');
}

main().catch(error => {
  console.error('FAIL: M1 endpoint preflight:', error.message);
  process.exitCode = 1;
});
