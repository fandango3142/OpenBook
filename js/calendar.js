/** Renders fresh, capacity-aware availability returned by the booking API. */
var CalendarUI = (function () {
  let _service = null;
  let _onSlotSelected = null;
  let _start = null;
  const DAY = 86400000;

  function init(service, onSlotSelected) {
    _service = service; _onSlotSelected = onSlotSelected;
    _start = new Date(); _start.setHours(0, 0, 0, 0);
    render();
  }
  function format(instant, zone, options) {
    return new Intl.DateTimeFormat(undefined, Object.assign({ timeZone: zone }, options)).format(new Date(instant));
  }
  function slotLabel(slot, businessZone, browserZone) {
    const business = format(slot.start_at, businessZone, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    if (browserZone && browserZone !== businessZone) {
      return business + ' (' + businessZone + ') · ' + format(slot.start_at, browserZone, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) + ' your time';
    }
    return business + ' (' + businessZone + ')';
  }
  function render() {
    const container = document.getElementById('calendar-container');
    if (!container || !_service) return;
    container.textContent = '';
    const controls = document.createElement('div'); controls.className = 'calendar-controls';
    const previous = document.createElement('button'); previous.type = 'button'; previous.className = 'btn btn-back'; previous.textContent = 'Previous week';
    const next = document.createElement('button'); next.type = 'button'; next.className = 'btn btn-back'; next.textContent = 'Next week';
    previous.disabled = _start.getTime() <= new Date().setHours(0, 0, 0, 0);
    previous.addEventListener('click', function () { _start = new Date(_start.getTime() - 7 * DAY); loadSlots(); });
    next.addEventListener('click', function () { _start = new Date(_start.getTime() + 7 * DAY); loadSlots(); });
    controls.append(previous, next); container.appendChild(controls);
    const list = document.createElement('div'); list.id = 'available-slots'; list.setAttribute('aria-live', 'polite');
    container.appendChild(list); loadSlots();
  }
  function loadSlots() {
    const list = document.getElementById('available-slots');
    if (!list) return;
    list.textContent = 'Loading available times…';
    const start = new Date(_start);
    const end = new Date(start.getTime() + 7 * DAY);
    const startAt = start.toISOString();
    const endAt = end.toISOString();
    const config = ConfigLoader.getConfig() || {};
    const businessZone = (config.settings && config.settings.business_timezone) || 'UTC';
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    ApiClient.getAvailability({ service_id: _service.service_id, start_at: startAt, end_at: endAt, quantity: 1 })
      .then(function (result) {
        list.textContent = '';
        (result.slots || []).forEach(function (slot) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'available-slot';
          button.textContent = slotLabel(slot, businessZone, browserZone);
          if (Number(slot.remaining_capacity) > 1) button.textContent += ' — ' + slot.remaining_capacity + ' places remaining';
          button.addEventListener('click', function () { if (_onSlotSelected) _onSlotSelected(slot); });
          list.appendChild(button);
        });
        if (!list.children.length) list.textContent = 'No available times this week. Try another week.';
      }).catch(function (error) {
        list.textContent = 'Unable to load available times. Please try again.';
        if (typeof App !== 'undefined' && App.showError) App.showError(error.message || 'Unable to load available times.');
      });
  }
  function refresh() { loadSlots(); }
  function destroy() { _service = null; _onSlotSelected = null; }
  return { init, refresh, destroy };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = CalendarUI;
