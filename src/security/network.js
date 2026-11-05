import { lookup } from 'node:dns/promises';
import net from 'node:net';

export class UnsafeDestinationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsafeDestinationError';
  }
}

function privateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113);
}

function privateIpv6(address) {
  const value = address.toLowerCase().split('%')[0];
  if (value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd')
    || /^fe[89abcef]/.test(value) || value.startsWith('ff') || value.startsWith('2001:db8:')
    || value.startsWith('2002:') || value.startsWith('64:ff9b:')) return true;

  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateIpv4(mapped[1]);
  const hexMapped = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const high = Number.parseInt(hexMapped[1], 16);
    const low = Number.parseInt(hexMapped[2], 16);
    return privateIpv4([high >> 8, high & 255, low >> 8, low & 255].join('.'));
  }
  if (value.startsWith('::') && !value.startsWith('::ffff:')) return true;
  return false;
}

export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return !privateIpv4(address);
  if (family === 6) return !privateIpv6(address);
  return false;
}

export async function resolvePublicAddresses(hostname) {
  if (net.isIP(hostname)) throw new UnsafeDestinationError('IP literal hosts are not accepted.');
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some(({ address }) => !isPublicAddress(address))) {
    throw new UnsafeDestinationError('The host resolves to a private or reserved network address.');
  }
  return records;
}
