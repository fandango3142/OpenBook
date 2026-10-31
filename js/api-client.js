/** Small client for the public Apps Script contract; availability is never cached. */
const ApiClient = (function () {
  let _baseUrl = '';
  function init(url) { _baseUrl = String(url || '').trim(); }
  function clientId() {
    try {
      let id = localStorage.getItem('openbook_client_id');
      if (!id) { id = 'c-' + Math.random().toString(36).slice(2); localStorage.setItem('openbook_client_id', id); }
      return id;
    } catch (e) { return 'c-' + Math.random().toString(36).slice(2); }
  }
  async function apiCall(action, data) {
    if (!_baseUrl || /YOUR_DEPLOYED|PLACEHOLDER/.test(_baseUrl)) {
      throw new Error('Booking server is not configured. Ask the business to finish setup.');
    }
    let response;
    try {
      response = await fetch(_baseUrl, { method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action, clientId: clientId() }, data || {})) });
    } catch (e) { throw new Error('Could not reach the booking server. Please try again.'); }
    if (!response.ok) throw new Error('The booking server could not complete the request. Please try again.');
    let result;
    try { result = await response.json(); }
    catch (e) { throw new Error('The booking server returned an invalid response. Please try again.'); }
    if (!result.success) {
      const error = new Error(result.error || 'The request could not be completed.');
      error.code = result.error || 'UNKNOWN_ERROR';
      throw error;
    }
    return result;
  }
  function listServices() { return apiCall('listServices'); }
  function getAvailability(request) { return apiCall('getAvailability', request); }
  function createBooking(request) { return apiCall('createBooking', request); }
  function getBooking(token) { return apiCall('getManagedBooking', { token }); }
  function cancelBooking(token) { return apiCall('requestCancellation', { token }); }
  function rescheduleBooking(token, requestedStart) { return apiCall('requestReschedule', { token, requested_start_at: requestedStart }); }
  return { init, apiCall, listServices, getAvailability, createBooking,
    getBooking, cancelBooking, rescheduleBooking, invalidatePrefetch: function () {} };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ApiClient;
