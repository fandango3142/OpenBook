/** Public booking flow: service -> slot -> contact -> confirm -> success. */
var App = (function () {
  let _currentStep = 1;
  let _selectedService = null;
  let _selectedSlot = null;
  let _pendingFormData = null;
  let _submitting = false;
  let _errorTimeout = null;

  function init() {
    ConfigLoader.loadAll().then(function (config) {
      renderServices(config.services || []);
      BookingForm.init(prepareConfirmation);
      document.getElementById('back-to-services').addEventListener('click', function () { goToStep(1); });
      document.getElementById('back-to-slots').addEventListener('click', function () { goToStep(2); });
      const edit = document.getElementById('back-to-details');
      if (edit) edit.addEventListener('click', function () { goToStep(3); });
      const confirm = document.getElementById('place-booking');
      if (confirm) confirm.addEventListener('click', function () { submitBooking(_pendingFormData); });
    }).catch(function (error) { showError(error.message || 'Could not load booking services.'); });
  }
  function renderServices(services) {
    const container = document.getElementById('services');
    container.textContent = '';
    services.forEach(function (service) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'service-card';
      const title = document.createElement('strong'); title.textContent = service.name; card.appendChild(title);
      const detail = document.createElement('span');
      detail.textContent = (service.description ? service.description + ' · ' : '') + service.duration_minutes + ' minutes';
      card.appendChild(detail);
      card.addEventListener('click', function () { selectService(service); });
      container.appendChild(card);
    });
    if (!services.length) showError('No booking services are currently available.');
  }
  function selectService(service) {
    _selectedService = service; _selectedSlot = null;
    document.getElementById('selected-service-info').textContent = service.name + ' · ' + service.duration_minutes + ' minutes';
    CalendarUI.init(service, onSlotSelected);
    goToStep(2);
  }
  function onSlotSelected(slot) {
    _selectedSlot = slot;
    const settings = (ConfigLoader.getConfig() || {}).settings || {};
    const zone = settings.business_timezone || 'UTC';
    const time = new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(slot.start_at));
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let label = _selectedService.name + ' · ' + time;
    if (browserZone && browserZone !== zone) {
      label += ' · Your time: ' + new Intl.DateTimeFormat(undefined, { timeZone: browserZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(slot.start_at));
    }
    document.getElementById('selected-slot-info').textContent = label;
    BookingForm.setCapacity(slot.remaining_capacity || 1);
    goToStep(3);
  }
  function prepareConfirmation(data) {
    _pendingFormData = data;
    document.getElementById('review-summary').textContent = _selectedService.name + ' · ' + _selectedService.duration_minutes + ' minutes · ' + data.name + ' · ' + data.email + ' · ' + data.quantity + ' place(s)';
    goToStep(4);
  }
  function goToStep(step) {
    for (let i = 1; i <= 5; i++) {
      const section = document.getElementById('step-' + i);
      if (section) section.classList.toggle('active', i === step);
    }
    document.querySelectorAll('.step-indicator .step').forEach(function (el) {
      const current = Number(el.dataset.step);
      el.classList.toggle('active', current === step);
      el.classList.toggle('completed', current < step);
    });
    _currentStep = step;
    hideError();
  }
  function showLoading() { const el = document.getElementById('loading'); if (el) el.classList.add('visible'); }
  function hideLoading() { const el = document.getElementById('loading'); if (el) el.classList.remove('visible'); }
  function showError(message, autoHideMs) {
    const banner = document.getElementById('error-banner');
    if (!banner) return;
    if (_errorTimeout) clearTimeout(_errorTimeout);
    banner.textContent = message;
    banner.classList.add('visible');
    if (autoHideMs) _errorTimeout = setTimeout(hideError, autoHideMs);
  }
  function hideError() {
    if (_errorTimeout) { clearTimeout(_errorTimeout); _errorTimeout = null; }
    const banner = document.getElementById('error-banner');
    if (banner) { banner.classList.remove('visible'); banner.textContent = ''; }
  }
  function submitBooking(formData) {
    if (_submitting) return;
    if (!_selectedService || !_selectedSlot || !formData) { showError('Choose a service and time before confirming.'); return; }
    const request = {
      service_id: _selectedService.service_id,
      start_at: _selectedSlot.start_at,
      quantity: Number(formData.quantity),
      customer: { name: formData.name, email: formData.email, phone: formData.phone || '' },
      hp: formData.hp || '',
    };
    _submitting = true;
    const button = document.getElementById('place-booking');
    if (button) button.disabled = true;
    showLoading();
    ApiClient.createBooking(request).then(function (result) {
      ApiClient.invalidatePrefetch();
      renderSuccess(result.booking, formData);
      goToStep(5);
    }).catch(function (error) {
      const stale = ['SLOT_UNAVAILABLE', 'INSUFFICIENT_CAPACITY'].indexOf(error.code) !== -1;
      if (stale) {
        ApiClient.invalidatePrefetch();
        _selectedSlot = null;
        goToStep(2);
        showError('That time is no longer available for the selected quantity. Choose another time.');
        CalendarUI.refresh();
      } else showError(error.message || 'Could not confirm this booking. Please try again.');
    }).finally(function () {
      hideLoading(); _submitting = false;
      if (button) button.disabled = false;
    });
  }
  function renderSuccess(booking, formData) {
    const container = document.getElementById('confirmation-content');
    container.textContent = '';
    const heading = document.createElement('h2'); heading.id = 'confirmation-heading'; heading.textContent = 'Booking confirmed'; container.appendChild(heading);
    const summary = document.createElement('p');
    const when = booking && booking.start_at ? booking.start_at : _selectedSlot.start_at;
    const zone = ((ConfigLoader.getConfig() || {}).settings || {}).business_timezone || 'UTC';
    const businessTime = new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(when));
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let displayTime = businessTime;
    if (browserZone && browserZone !== zone) {
      displayTime += ' · Your time: ' + new Intl.DateTimeFormat(undefined, { timeZone: browserZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(when));
    }
    summary.textContent = _selectedService.name + ' · ' + displayTime + ' · ' + formData.email;
    container.appendChild(summary);
    if (booking && booking.booking_id) {
      const id = document.createElement('p'); id.textContent = 'Booking reference: ' + booking.booking_id; container.appendChild(id);
    }
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else if (document.getElementById('services')) init();
  }
  return { init, goToStep, showLoading, hideLoading, showError, hideError, submitBooking,
    getSelectedService: function () { return _selectedService; }, getSelectedSlot: function () { return _selectedSlot; } };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = App;
