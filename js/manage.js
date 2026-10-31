/* Customer self-service for requesting booking changes. Never renders the token. */
var ManagePage = (function () {
  function tokenFromLocation() {
    return typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') : null;
  }
  function content() { return document.getElementById('manage-content'); }
  function message(text) {
    content().textContent = '';
    var p = document.createElement('p');
    p.textContent = text;
    content().appendChild(p);
  }
  function errorMessage(target, text) {
    target.textContent = text;
    target.hidden = false;
  }
  function call(action, data) { return ApiClient.apiCall(action, data); }

  function render(result, token) {
    var root = content();
    root.textContent = '';
    var booking = result.booking || {};
    var heading = document.createElement('h1');
    heading.textContent = 'Manage your booking';
    root.appendChild(heading);
    var details = document.createElement('dl');
    [
      ['Service', booking.service_name],
      ['Start time', booking.start_at],
      ['Status', booking.status],
    ].forEach(function (item) {
      var term = document.createElement('dt'); term.textContent = item[0];
      var value = document.createElement('dd'); value.textContent = item[1] || '';
      details.appendChild(term); details.appendChild(value);
    });
    root.appendChild(details);
    var actions = result.actions || {};
    if (actions.can_request_cancellation) {
      var cancel = document.createElement('button');
      cancel.type = 'button'; cancel.className = 'btn btn-primary';
      cancel.dataset.action = 'request-cancellation'; cancel.textContent = 'Request cancellation';
      cancel.addEventListener('click', function () {
        cancel.disabled = true;
        call('requestCancellation', { token: token }).then(renderResult).catch(function () {
          cancel.disabled = false;
          errorMessage(document.getElementById('manage-error'), 'We could not submit that request. Please try again.');
        });
      });
      root.appendChild(cancel);
    }
    if (actions.can_request_reschedule) {
      var open = document.createElement('button');
      open.type = 'button'; open.className = 'btn';
      open.dataset.action = 'request-reschedule'; open.textContent = 'Request a new time';
      var form = document.createElement('form'); form.id = 'reschedule-request-form'; form.hidden = true;
      var label = document.createElement('label'); label.htmlFor = 'requested-start';
      label.textContent = 'Requested date and time (your local time)';
      var input = document.createElement('input'); input.id = 'requested-start'; input.name = 'requested_start';
      input.type = 'datetime-local'; input.required = true;
      var submit = document.createElement('button'); submit.type = 'submit';
      submit.dataset.action = 'submit-reschedule-request'; submit.textContent = 'Send request';
      form.appendChild(label); form.appendChild(input); form.appendChild(submit);
      open.addEventListener('click', function () { form.hidden = false; input.focus(); });
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!input.value) return;
        submit.disabled = true;
        var requestedStart;
        try { requestedStart = new Date(input.value).toISOString(); }
        catch (e) { submit.disabled = false; return; }
        call('requestReschedule', { token: token, requested_start_at: requestedStart })
          .then(renderResult).catch(function () {
            submit.disabled = false;
            errorMessage(document.getElementById('manage-error'), 'We could not submit that request. Please try again.');
          });
      });
      root.appendChild(open); root.appendChild(form);
    }
  }
  function renderResult(result) {
    var text = result.booking && result.booking.status === 'CANCELLATION_REQUESTED' ?
      'Your cancellation request has been sent. Your booking remains active until the business confirms it.' :
      'Your request has been sent. Your existing booking remains active until the business reviews it.';
    message(text);
  }
  function init(opts) {
    opts = opts || {};
    var token = Object.prototype.hasOwnProperty.call(opts, 'token') ? opts.token : tokenFromLocation();
    var err = document.getElementById('manage-error');
    var loading = document.getElementById('manage-loading');
    if (!token || typeof token !== 'string') { message('This management link is invalid.'); return Promise.resolve(); }
    if (loading) loading.hidden = false;
    return ConfigLoader.loadAll().then(function (config) {
      ApiClient.init(config.settings.apps_script_url);
      return call('getManagedBooking', { token: token });
    }).then(function (result) {
      if (loading) loading.hidden = true;
      if (err) err.hidden = true;
      render(result, token);
    }).catch(function () {
      if (loading) loading.hidden = true;
      message('This booking could not be loaded. Check the link or contact the business.');
    });
  }
  return { init: init };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ManagePage;
