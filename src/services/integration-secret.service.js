import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function encryptionKey() {
  const value = process.env.INTEGRATION_KEY_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Integration encryption key is not configured.');
  return Buffer.from(value, 'hex');
}

function encrypt(value) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    webhookSecretCiphertext: ciphertext.toString('base64'),
    webhookSecretNonce: nonce.toString('hex'),
    webhookSecretTag: cipher.getAuthTag().toString('hex'),
  };
}

function decrypt(integration) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(integration.webhookSecretNonce, 'hex'));
  decipher.setAuthTag(Buffer.from(integration.webhookSecretTag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(integration.webhookSecretCiphertext, 'base64')),
    decipher.final(),
  ]);
}

export async function rotateWebhookSecret(prisma, projectId) {
  const secret = randomBytes(32).toString('base64url');
  const encrypted = encrypt(secret);
  const at = new Date();
  await prisma.$transaction([
    prisma.projectIntegration.upsert({
      where: { projectId },
      create: { projectId, ...encrypted, webhookConfiguredAt: at },
      update: { ...encrypted, webhookConfiguredAt: at, lastSignedEventAt: null, liveAuditCapability: 'CONFIGURATION_REQUIRED' },
    }),
    prisma.integrationCapability.upsert({
      where: { projectId_name: { projectId, name: 'live-admin-audit-feed' } },
      create: {
        projectId,
        name: 'live-admin-audit-feed',
        status: 'CONFIGURATION_REQUIRED',
        evidence: 'Secret created. Waiting for the original application to send its first signed event.',
      },
      update: {
        status: 'CONFIGURATION_REQUIRED',
        evidence: 'Secret rotated. Waiting for the original application to send its first signed event.',
        verifiedAt: null,
      },
    }),
  ]);
  return secret;
}

export function verifyWebhookSignature(integration, timestamp, rawBody, suppliedSignature) {
  if (!integration?.webhookSecretCiphertext || !integration.webhookSecretNonce || !integration.webhookSecretTag) return false;
  const secret = decrypt(integration);
  const expected = createHmac('sha256', secret).update(timestamp).update('.').update(rawBody).digest();
  const normalized = String(suppliedSignature || '').replace(/^sha256=/i, '');
  if (!/^[a-f0-9]{64}$/i.test(normalized)) return false;
  const actual = Buffer.from(normalized, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
