import { describe, expect, it } from 'vitest';
import { allowedHosts } from '../src/server/hostcheck.ts';

const M = 'DESKTOP-ABC'; // osHostname() is upper-cased on Windows

describe('allowedHosts', () => {
  it('loopback binds accept loopback names only', () => {
    const a = allowedHosts('127.0.0.1', false, true, '127.0.0.1', M);
    for (const ok of ['localhost', '127.0.0.1', '[::1]']) expect(a.has(ok)).toBe(true);
    expect(a.has('desktop-abc')).toBe(false); // machine name would be a rebind bypass
    expect(a.has('evil.com')).toBe(false);
  });

  it('non-loopback binds accept the bind name and machine name', () => {
    const a = allowedHosts('192.168.1.5', false, false, '192.168.1.5', M);
    expect(a.has('192.168.1.5')).toBe(true);
    expect(a.has('desktop-abc')).toBe(true); // case-insensitive
    expect(a.has('other-host')).toBe(false);
  });

  it('IPv6 binds accept the bracketed bind name', () => {
    const a = allowedHosts('::1', false, true, '::1', M);
    expect(a.has('[::1]')).toBe(true);
  });

  it('wildcard binds accept the socket local address', () => {
    const a = allowedHosts('0.0.0.0', true, false, '192.168.1.5', M);
    expect(a.has('192.168.1.5')).toBe(true);
    expect(a.has('desktop-abc')).toBe(true); // LAN demo via machine name
    expect(a.has('attacker.example')).toBe(false);
  });

  it('normalizes IPv4-mapped IPv6 socket addresses', () => {
    const a = allowedHosts('::', true, false, '::ffff:192.168.1.5', M);
    expect(a.has('192.168.1.5')).toBe(true);
    expect(a.has('[::ffff:192.168.1.5]')).toBe(false); // bracket form not offered
  });

  it('brackets only real IPv6 socket addresses', () => {
    const a = allowedHosts('::', true, false, '2001:db8::1', M);
    expect(a.has('[2001:db8::1]')).toBe(true);
  });

  it('EKG_ALLOWED_HOSTS-style extras open named access off loopback', () => {
    const a = allowedHosts('0.0.0.0', true, false, '10.0.0.9', M, ['mybox.local']);
    expect(a.has('mybox.local')).toBe(true);
    const loop = allowedHosts('127.0.0.1', false, true, '127.0.0.1', M, ['mybox.local']);
    expect(loop.has('mybox.local')).toBe(false); // extras stay off loopback
  });
});
