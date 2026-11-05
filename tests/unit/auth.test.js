import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, hashUnusablePassword, verifyPassword } from '../../src/services/auth.service.js';
import { loginSchema, createUserSchema } from '../../src/validators/auth.schema.js';

test('passwords use a non-reversible Argon2id hash', async () => {
  const password = 'correct horse purple portal!';
  const hash = await hashPassword(password);
  assert.notEqual(hash, password);
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(hash, password), true);
  assert.equal(await verifyPassword(hash, 'incorrect password'), false);
});

test('authentication schemas normalize email and allow portal users without a password', () => {
  assert.equal(loginSchema.parse({ email: 'ADMIN@example.com', password: 'x' }).email, 'admin@example.com');
  assert.deepEqual(createUserSchema.parse({ name: 'New Admin', email: 'ADMIN@example.com', role: 'VIEWER' }), {
    name: 'New Admin', email: 'admin@example.com', role: 'VIEWER',
  });
  assert.equal(createUserSchema.safeParse({ name: 'New Admin', email: 'admin@example.com', role: 'SUPER_ADMIN' }).success, false);
});

test('Google-only portal users receive an Argon2id hash for an unshared random credential', async () => {
  const hash = await hashUnusablePassword();
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(hash, 'a password the invitee never received'), false);
});
