const fsp = require('fs/promises');

// Only the first few KB of a file ever contain the container signature we
// need (ISO-BMFF ftyp box or an EBML header) — reading a small, fixed-size
// window means this check has a hard, predictable cost regardless of how
// large or malformed the uploaded file is.
const HEADER_READ_BYTES = 4096;

/**
 * Reads at most `length` bytes from the start of a file. Returns a buffer
 * that may be shorter than `length` for small/short files — callers must
 * bounds-check before reading, not assume a full-length buffer.
 */
async function readHeader(filePath, length = HEADER_READ_BYTES) {
  const fh = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * Detects exactly the 4 video container formats this app accepts
 * (mp4, mov, mkv, webm) by magic bytes — nothing else.
 *
 * This intentionally replaces a general-purpose "detect anything" file
 * sniffing library. Those libraries carry parsers for dozens of formats
 * this app will never accept (including formats with known parser bugs,
 * e.g. GHSA-5v7r-6r5c-r473, an infinite-loop DoS in an ASF parser reached
 * during format auto-detection on untrusted bytes — before any
 * extension/MIME allowlist ever gets a chance to reject the file).
 * Narrowing detection to only the formats we actually support removes
 * that entire class of risk: there is no ASF parser (or any other
 * unsupported-format parser) in this codebase to have a bug in.
 *
 * Every branch here does a bounded, single-pass scan over a small fixed
 * buffer — no recursion, no format-specific state machine that could be
 * driven into a loop by crafted input.
 */
function detectFromBuffer(buf) {
  if (buf.length < 4) return null;

  // ISO-BMFF (MP4 / QuickTime): a `ftyp` box a few bytes in, whose "major
  // brand" (4 ASCII bytes right after `ftyp`) tells mp4 and mov apart.
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12).trim().toLowerCase();
    if (brand === 'qt') {
      return { ext: '.mov', mime: 'video/quicktime' };
    }
    return { ext: '.mp4', mime: 'video/mp4' };
  }

  // EBML (Matroska / WebM) — both formats share the same 4-byte EBML
  // magic number; a DocType string ("matroska" or "webm") appearing in
  // the header distinguishes them. A plain bounded substring search over
  // the already-capped header buffer is sufficient and safe here — no
  // recursive/variable-length EBML element parsing is needed for a
  // format that lives entirely inside the first few KB.
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    const ascii = buf.toString('latin1');
    if (ascii.includes('webm')) {
      return { ext: '.webm', mime: 'video/webm' };
    }
    if (ascii.includes('matroska')) {
      return { ext: '.mkv', mime: 'video/x-matroska' };
    }
    return null; // an EBML file, but not one of the two profiles we support
  }

  return null;
}

async function detectVideoContainer(filePath) {
  const header = await readHeader(filePath);
  return detectFromBuffer(header);
}

module.exports = { detectVideoContainer, detectFromBuffer, HEADER_READ_BYTES };
