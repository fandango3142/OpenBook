/**
 * TokenService — generates and validates secure booking tokens.
 * Tokens are UUID v4 with a 90-day expiry window.
 */

var TokenService = (function () {
  function generateToken() {
    return Utilities.getUuid();
  }

  function hashToken(token) {
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token);
    return digest.map(function (byte) {
      return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
    }).join('');
  }

  function getExpiryDate() {
    var expiryDays = Config.getNumber('TOKEN_EXPIRY_DAYS') || 90;
    var expiry = new Date();
    expiry.setDate(expiry.getDate() + expiryDays);
    return expiry.toISOString();
  }

  function validateToken(token) {
    if (!token || typeof token !== 'string') return false;

    var booking = BookingStore.getByToken(token);
    if (!booking) return false;

    // Check expiry
    if (booking.tokenExpiresAt) {
      var expiryDate = new Date(booking.tokenExpiresAt);
      if (new Date() > expiryDate) return false;
    }

    return true;
  }

  return {
    generateToken: generateToken,
    hashToken: hashToken,
    getExpiryDate: getExpiryDate,
    validateToken: validateToken,
  };
})();
