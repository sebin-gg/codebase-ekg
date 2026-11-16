import { hostname as osHostname } from 'node:os';

/** Builds the Host-header allowlist for a bind. Pure so tests can pin the
 *  rebinding rules: loopback always allowed; wildcard adds the socket's real
 *  local address; the machine hostname is only safe on non-loopback binds;
 *  extra names come from EKG_ALLOWED_HOSTS (comma-separated). */
export function allowedHosts(
  host: string,
  wildcard: boolean,
  loopback: boolean,
  localAddress: string,
  machineName = osHostname(),
  extra = (process.env.EKG_ALLOWED_HOSTS ?? '').split(',').filter(Boolean),
): Set<string> {
  const local = localAddress;
  const localV4 = local.replace(/^::ffff:/, '');
  const localIsV6 = local.includes(':') && !local.startsWith('::ffff:');
  const machine = machineName.toLowerCase();
  const list = wildcard
    ? ['localhost', '127.0.0.1', '[::1]', localV4, localIsV6 ? `[${local}]` : '', machine, ...extra]
    : ['localhost', '127.0.0.1', '[::1]', host.includes(':') ? `[${host}]` : host,
      ...(loopback ? [] : [machine]), ...(loopback ? [] : extra)];
  return new Set(list.filter(Boolean).map((h) => h.toLowerCase()));
}

