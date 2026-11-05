import { createHash, createHmac, randomBytes } from 'node:crypto';
import argon2 from 'argon2';

const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};
let dummyHashPromise;

export function hashPassword(password) {
  return argon2.hash(password, ARGON_OPTIONS);
}

export function hashUnusablePassword() {
  return hashPassword(randomBytes(32).toString('base64url'));
}

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password, { type: argon2.argon2id });
  } catch {
    return false;
  }
}

function rateKey(value) {
  const key = process.env.RATE_LIMIT_SECRET || process.env.SESSION_SECRET;
  if (!key) throw new Error('Rate-limit key is not configured.');
  return createHmac('sha256', key).update(value).digest('hex');
}

export async function loginRateState(prisma, email, ip) {
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const identityKey = rateKey('email:' + email);
  const networkKey = rateKey('ip:' + ip);
  const [identityFailures, networkFailures] = await Promise.all([
    prisma.authenticationAttempt.count({ where: { identityKey, succeeded: false, occurredAt: { gte: since } } }),
    prisma.authenticationAttempt.count({ where: { networkKey, succeeded: false, occurredAt: { gte: since } } }),
  ]);
  return {
    identityKey,
    networkKey,
    blocked: identityFailures >= 10 || networkFailures >= 40,
    retryAt: new Date(since.getTime() + 15 * 60 * 1000),
  };
}

export async function recordLoginAttempt(prisma, { identityKey, networkKey, succeeded }) {
  await prisma.authenticationAttempt.create({
    data: { identityKey, networkKey, succeeded },
  });
}

export async function verifyLogin(prisma, email, password) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!dummyHashPromise) dummyHashPromise = argon2.hash(randomBytes(32), ARGON_OPTIONS);
  const valid = await verifyPassword(user?.passwordHash || await dummyHashPromise, password);
  if (!user || !user.isActive || !valid) return null;
  return user;
}

export function safeClientAddress(ip) {
  return createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 64);
}
