const { isPublicAddress } = require('../src/security/ssrfSafeFetch');

describe('isPublicAddress (SSRF IP-range classification)', () => {
  describe('blocks IPv4 non-public ranges', () => {
    it.each([
      ['127.0.0.1', 'loopback'],
      ['127.255.255.255', 'loopback (full range)'],
      ['0.0.0.0', 'unspecified'],
      ['10.0.0.1', 'private (RFC1918 10/8)'],
      ['172.16.0.1', 'private (RFC1918 172.16/12)'],
      ['172.31.255.255', 'private (RFC1918 172.16/12 upper bound)'],
      ['192.168.1.1', 'private (RFC1918 192.168/16)'],
      ['169.254.169.254', 'link-local — cloud metadata endpoint (AWS/GCP/Azure)'],
      ['169.254.0.1', 'link-local'],
      ['100.64.0.1', 'carrier-grade NAT (RFC6598)'],
      ['192.0.2.1', 'reserved (TEST-NET-1)'],
      ['198.51.100.1', 'reserved (TEST-NET-2)'],
      ['203.0.113.1', 'reserved (TEST-NET-3)'],
      ['255.255.255.255', 'broadcast'],
      ['224.0.0.1', 'multicast'],
    ])('rejects %s (%s)', (address) => {
      expect(isPublicAddress(address)).toBe(false);
    });
  });

  describe('blocks IPv6 non-public ranges', () => {
    it.each([
      ['::1', 'loopback'],
      ['::', 'unspecified'],
      ['fe80::1', 'link-local'],
      ['fc00::1', 'unique local (RFC4193)'],
      ['fd00::1', 'unique local (RFC4193)'],
      ['ff02::1', 'multicast'],
    ])('rejects %s (%s)', (address) => {
      expect(isPublicAddress(address)).toBe(false);
    });

    it('rejects IPv4-mapped IPv6 loopback (::ffff:127.0.0.1) — closes the mapped-address bypass', () => {
      expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
    });

    it('rejects IPv4-mapped IPv6 private address (::ffff:10.0.0.1)', () => {
      expect(isPublicAddress('::ffff:10.0.0.1')).toBe(false);
    });

    it('rejects IPv4-mapped IPv6 cloud metadata address (::ffff:169.254.169.254)', () => {
      expect(isPublicAddress('::ffff:169.254.169.254')).toBe(false);
    });
  });

  describe('allows genuinely public addresses', () => {
    it.each([
      ['8.8.8.8', 'public IPv4 (Google DNS)'],
      ['1.1.1.1', 'public IPv4 (Cloudflare DNS)'],
      ['93.184.216.34', 'public IPv4'],
      ['2001:4860:4860::8888', 'public IPv6 (Google DNS)'],
    ])('allows %s (%s)', (address) => {
      expect(isPublicAddress(address)).toBe(true);
    });
  });

  describe('malformed input', () => {
    it('rejects garbage strings rather than throwing', () => {
      expect(isPublicAddress('not-an-ip-address')).toBe(false);
      expect(isPublicAddress('')).toBe(false);
      expect(isPublicAddress('999.999.999.999')).toBe(false);
    });
  });
});
