const path = require('path');

/**
 * Sanitizes a user-supplied filename for safe *display/metadata* use only.
 * This value must never be used to construct a storage path directly —
 * storage keys are always server-generated (see src/storage).
 */
function sanitizeDisplayFilename(original) {
  if (typeof original !== 'string' || original.length === 0) {
    return 'upload';
  }
  const base = path.basename(original); // strips any directory component
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  return cleaned.length > 0 ? cleaned : 'upload';
}

function extensionFromFilename(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  return ext.replace(/[^a-z0-9.]/g, '');
}

module.exports = { sanitizeDisplayFilename, extensionFromFilename };
