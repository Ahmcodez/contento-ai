/**
 * Parses an HTTP Range header for a file of `size` bytes.
 *  - null: no usable range, so send the whole file (RFC 9110 lets a server ignore a Range
 *    it doesn't understand; multi-range requests are treated that way too, browsers don't
 *    send them for video)
 *  - 'unsatisfiable': the range is outside the file (reply 416)
 *  - { start, end }: inclusive byte offsets, already clamped to the file
 */
function parseByteRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return null;

  const [, first, last] = match;
  if (first === '' && last === '') return null;

  if (first === '') {
    // "-N": the last N bytes
    const n = Number(last);
    if (n === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }

  const start = Number(first);
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

module.exports = { parseByteRange };
