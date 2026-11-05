import test from 'node:test';
import assert from 'node:assert/strict';
import { adminUrlSchema, normalizeAdminUrl } from '../../src/validators/project.schema.js';
import { isPublicAddress } from '../../src/security/network.js';

test('Admin URL validation accepts secure public URL shape only', () => {
  assert.equal(adminUrlSchema.safeParse('https://shop.example.com/admin').success, true);
  assert.equal(adminUrlSchema.safeParse('http://shop.example.com/admin').success, false);
  assert.equal(adminUrlSchema.safeParse('https://user:pass@shop.example.com/admin').success, false);
  assert.equal(adminUrlSchema.safeParse('https://shop.example.com/admin?token=abc').success, false);
  assert.equal(adminUrlSchema.safeParse('https://shop.example.com:8443/admin').success, false);
});

test('Admin URL normalization removes redundant trailing slashes', () => {
  assert.equal(normalizeAdminUrl('https://shop.example.com/admin///'), 'https://shop.example.com/admin');
  assert.equal(normalizeAdminUrl('https://shop.example.com/'), 'https://shop.example.com/');
});

test('outbound address classification blocks private, local, and reserved ranges', () => {
  for (const address of [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.2.4',
    '172.16.0.1', '192.168.1.2', '224.0.0.1', '::', '::1', 'fc00::1',
    'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1',
  ]) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});
