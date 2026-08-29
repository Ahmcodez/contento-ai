const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  detectFromBuffer,
  detectVideoContainer,
  HEADER_READ_BYTES,
} = require('../src/utils/detectVideoContainer');

function ebmlHeaderWithDocType(docType) {
  // Minimal, well-formed-enough EBML header for detection purposes: the
  // 4-byte EBML magic followed somewhere later by the ASCII DocType
  // string. Real files have proper element IDs/sizes around it; the
  // detector only substring-searches, so this fixture doesn't need to be
  // a fully valid EBML document.
  return Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
    Buffer.from([0x42, 0x82, 0x80 | docType.length]), // fake DocType element id/size
    Buffer.from(docType, 'ascii'),
  ]);
}

describe('detectFromBuffer', () => {
  it('detects a real mp4 fixture via its ftyp box', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'sample.mp4');
    const buf = fs.readFileSync(fixturePath).subarray(0, HEADER_READ_BYTES);
    expect(detectFromBuffer(buf)).toEqual({ ext: '.mp4', mime: 'video/mp4' });
  });

  it('detects an mp4 major brand as video/mp4', () => {
    const buf = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x20]),
      Buffer.from('ftyp', 'ascii'),
      Buffer.from('isom', 'ascii'),
      Buffer.alloc(4),
    ]);
    expect(detectFromBuffer(buf)).toEqual({ ext: '.mp4', mime: 'video/mp4' });
  });

  it('detects a QuickTime major brand as video/quicktime', () => {
    const buf = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x14]),
      Buffer.from('ftyp', 'ascii'),
      Buffer.from('qt  ', 'ascii'),
      Buffer.alloc(4),
    ]);
    expect(detectFromBuffer(buf)).toEqual({ ext: '.mov', mime: 'video/quicktime' });
  });

  it('detects an EBML/webm DocType as video/webm', () => {
    expect(detectFromBuffer(ebmlHeaderWithDocType('webm'))).toEqual({
      ext: '.webm',
      mime: 'video/webm',
    });
  });

  it('detects an EBML/matroska DocType as video/x-matroska', () => {
    expect(detectFromBuffer(ebmlHeaderWithDocType('matroska'))).toEqual({
      ext: '.mkv',
      mime: 'video/x-matroska',
    });
  });

  it('returns null for an EBML file whose DocType is neither webm nor matroska', () => {
    expect(detectFromBuffer(ebmlHeaderWithDocType('somethingelse'))).toBeNull();
  });

  it('returns null for plain text content', () => {
    const buf = Buffer.from('this is not really an mp4 file', 'ascii');
    expect(detectFromBuffer(buf)).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    expect(detectFromBuffer(Buffer.alloc(0))).toBeNull();
  });

  it('returns null for a buffer shorter than the ftyp offset', () => {
    expect(detectFromBuffer(Buffer.from([0x00, 0x00]))).toBeNull();
  });

  it('does not hang or throw on adversarial EBML-looking input (regression guard for the ASF-class infinite-loop bug this replaces)', () => {
    // A buffer that starts with the EBML magic but is otherwise garbage —
    // this is the shape of input that triggered an infinite loop in the
    // ASF parser this sniffer replaces (GHSA-5v7r-6r5c-r473). The
    // detector must return promptly regardless of what follows the magic
    // bytes, since it only does a bounded substring search, never a
    // parser state machine.
    const adversarial = Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      Buffer.alloc(HEADER_READ_BYTES - 4, 0x00),
    ]);
    const start = Date.now();
    const result = detectFromBuffer(adversarial);
    expect(Date.now() - start).toBeLessThan(100);
    expect(result).toBeNull();
  });
});

describe('detectVideoContainer', () => {
  const tmpDir = path.join(os.tmpdir(), 'contento-detect-container-test');

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  it('reads only the header of a real file from disk', async () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'sample.mp4');
    const result = await detectVideoContainer(fixturePath);
    expect(result).toEqual({ ext: '.mp4', mime: 'video/mp4' });
  });

  it('handles a file shorter than the header read window', async () => {
    const shortPath = path.join(tmpDir, 'short.bin');
    fs.writeFileSync(shortPath, Buffer.from([0x00, 0x01]));
    const result = await detectVideoContainer(shortPath);
    expect(result).toBeNull();
  });

  it('handles a zero-byte file', async () => {
    const emptyPath = path.join(tmpDir, 'empty.bin');
    fs.writeFileSync(emptyPath, Buffer.alloc(0));
    const result = await detectVideoContainer(emptyPath);
    expect(result).toBeNull();
  });
});
