/** A safe, readable download filename from a video title. */
function sanitizeFilename(title, ext) {
  const cleaned = String(title || '')
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
    .trim();
  return `${cleaned || 'video'}${ext}`;
}

/**
 * Content-Disposition for an attachment: an ASCII fallback for old clients plus the RFC 5987
 * UTF-8 form, so titles in any language still download under their own name.
 */
function contentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

module.exports = { sanitizeFilename, contentDisposition };
