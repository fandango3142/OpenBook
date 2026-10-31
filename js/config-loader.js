/** Loads neutral site settings; booking services always come from the API. */
const ConfigLoader = (function () {
  let _config = null;

  async function loadAll() {
    if (_config) return _config;
    const response = await fetch('./config/settings.yaml');
    if (!response.ok) throw new Error(`Failed to load site settings: ${response.status}`);
    const settings = jsyaml.load(await response.text()) || {};
    if (typeof ApiClient === 'undefined') throw new Error('Booking API is unavailable');
    ApiClient.init(settings.apps_script_url || '');
    const result = await ApiClient.listServices();
    const services = (result.services || []).filter((service) => service && service.service_id && service.name &&
      Number.isInteger(Number(service.duration_minutes)) && Number(service.duration_minutes) > 0 &&
      Number.isInteger(Number(service.capacity)) && Number(service.capacity) > 0);
    if (!services.length) throw new Error('No bookable services are currently available');
    _config = { settings, services };
    return _config;
  }

  function getConfig() { return _config; }
  function resetConfig() { _config = null; }
  return { loadAll, getConfig, resetConfig };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ConfigLoader;
