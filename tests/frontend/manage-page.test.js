const fs = require('fs');
const path = require('path');

function pageDOM() {
  document.body.innerHTML = '<main><div id="manage-content"></div><div id="manage-error" role="alert"></div><div id="manage-loading"></div></main>';
}

describe('customer management page', () => {
  let ManagePage;
  const token = 'secret-management-token';
  const booking = { booking_id: 'BKG_1', service_name: '<img src=x onerror=alert(1)>', start_at: '2026-11-02T03:30:00.000Z', status: 'CONFIRMED' };

  beforeEach(() => {
    jest.resetModules();
    pageDOM();
    window.history.replaceState({}, '', '/manage.html?token=' + token);
    global.ConfigLoader = { loadAll: () => Promise.resolve({ settings: { apps_script_url: 'https://example.test' } }) };
    global.ApiClient = {
      init: jest.fn(),
      apiCall: jest.fn((action) => Promise.resolve(action === 'getManagedBooking' ?
        { booking, actions: { can_request_cancellation: true, can_request_reschedule: true } } :
        { booking: Object.assign({}, booking, { status: action === 'requestCancellation' ? 'CANCELLATION_REQUESTED' : 'RESCHEDULE_REQUESTED' }) })),
    };
    global.console = Object.assign({}, console, { log: jest.fn(), error: jest.fn(), warn: jest.fn() });
    ManagePage = require('../../js/manage');
  });

  test('loads only the token-selected booking and renders untrusted values as text', async () => {
    await ManagePage.init();
    expect(global.ApiClient.apiCall).toHaveBeenCalledWith('getManagedBooking', { token });
    expect(document.querySelector('#manage-content img')).toBeNull();
    expect(document.getElementById('manage-content').textContent).toContain(booking.service_name);
    expect(document.getElementById('manage-content').textContent).not.toContain(token);
    expect(global.console.log).not.toHaveBeenCalledWith(expect.stringContaining(token));
  });

  test('exposes request buttons only when allowed and sends explicit user actions', async () => {
    await ManagePage.init();
    const cancel = document.querySelector('[data-action="request-cancellation"]');
    const reschedule = document.querySelector('[data-action="request-reschedule"]');
    expect(cancel).not.toBeNull();
    expect(reschedule).not.toBeNull();
    reschedule.click();
    expect(document.querySelector('#reschedule-request-form').hidden).toBe(false);
    document.querySelector('#requested-start').value = '2026-11-02T04:30';
    document.querySelector('[data-action="submit-reschedule-request"]').click();
    expect(global.ApiClient.apiCall).toHaveBeenLastCalledWith('requestReschedule', { token, requested_start_at: expect.any(String) });
  });

  test('cancellation request is sent only after an explicit click', async () => {
    await ManagePage.init();
    expect(global.ApiClient.apiCall).not.toHaveBeenCalledWith('requestCancellation', expect.anything());
    document.querySelector('[data-action="request-cancellation"]').click();
    expect(global.ApiClient.apiCall).toHaveBeenLastCalledWith('requestCancellation', { token });
  });

  test('hides actions that are disabled or invalid for the current state', async () => {
    global.ApiClient.apiCall.mockResolvedValue({
      booking: Object.assign({}, booking, { status: 'CANCELLATION_REQUESTED' }), actions: { can_request_cancellation: false, can_request_reschedule: false },
    });
    await ManagePage.init();
    expect(document.querySelector('[data-action="request-cancellation"]')).toBeNull();
    expect(document.querySelector('[data-action="request-reschedule"]')).toBeNull();
  });

  test('missing token does not call the API or expose token data', async () => {
    window.history.replaceState({}, '', '/manage.html');
    await ManagePage.init();
    expect(global.ApiClient.apiCall).not.toHaveBeenCalled();
    expect(document.getElementById('manage-content').textContent).not.toContain(token);
  });
});
