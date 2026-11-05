import test from 'node:test';
import assert from 'node:assert/strict';
import { externalAuditEventSchema, sanitizeChanges } from '../../src/validators/external-event.schema.js';

test('external audit events require stable ids, timestamp, action, and entity type', () => {
  const result = externalAuditEventSchema.safeParse({
    id: 'evt_123',
    occurredAt: '2026-08-25T12:30:00.000Z',
    action: 'updated',
    entityType: 'product',
    changes: [{ field: 'price', before: 500, after: 600 }],
  });
  assert.equal(result.success, true);
  assert.equal(result.data.severity, 'INFO');
});

test('external audit schema rejects malformed or overlarge change data', () => {
  const common = {
    id: 'evt_123',
    occurredAt: '2026-08-25T12:30:00.000Z',
    action: 'updated',
    entityType: 'product',
  };
  assert.equal(externalAuditEventSchema.safeParse({ ...common, changes: [{ field: 'price', after: { amount: 10 } }] }).success, false);
  assert.equal(externalAuditEventSchema.safeParse({ ...common, unknown: 'field' }).success, false);
});

test('sensitive field values are excluded from portal audit metadata', () => {
  const sanitized = sanitizeChanges([
    { field: 'price', before: 5, after: 6 },
    { field: 'customerEmail', before: 'old@example.com', after: 'new@example.com' },
    { field: 'api_token', before: 'secret', after: 'new secret' },
  ]);
  assert.deepEqual(sanitized, [{ field: 'price', before: 5, after: 6 }]);
});
