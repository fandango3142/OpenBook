/**
 * TokenService — generates and validates secure booking tokens.
 * New hashed tokens are UUID v4 and remain valid while the booking allows it.
 * Legacy tokens honor an expiry explicitly stored with their booking.
 */

var TokenService = (function () {
  function generateToken() {
    return Utilities.getUuid();
  }

  function hash(token) {
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
    return digest.map(function (byte) {
      return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
    }).join('');
  }

  function issue() {
    var token = generateToken();
    return { token: token, hash: hash(token) };
  }

  function matches(token, storedHash) {
    if (typeof token !== 'string' || !token) return false;
    var candidate = hash(token);
    var expected = typeof storedHash === 'string' ? storedHash : '';
    var difference = candidate.length ^ expected.length;
    for (var i = 0; i < candidate.length; i++) {
      difference |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return difference === 0;
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

    // Only legacy rows can carry an explicitly stored expiry.
    if (!booking._tokenHash && booking.tokenExpiresAt) {
      var expiryDate = new Date(booking.tokenExpiresAt);
      if (new Date() > expiryDate) return false;
    }

    return true;
  }

  return {
    issue: issue,
    hash: hash,
    matches: matches,
    generateToken: generateToken,
    hashToken: hash,
    getExpiryDate: getExpiryDate,
    validateToken: validateToken,
  };
})();
