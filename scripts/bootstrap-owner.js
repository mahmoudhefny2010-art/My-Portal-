import 'dotenv/config';
import { z } from 'zod';
import { prisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/services/auth.service.js';

const ownerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
});

let exitCode = 0;
try {
  const parsed = ownerSchema.safeParse({
    name: process.env.PORTAL_OWNER_NAME,
    email: process.env.PORTAL_OWNER_EMAIL,
    password: process.env.PORTAL_OWNER_PASSWORD,
  });
  if (!parsed.success) throw new Error('Set a name, valid email, and password of at least 12 characters.');

  await prisma.$connect();
  const existingOwner = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
  if (existingOwner) throw new Error('A Super Admin already exists. No account was created.');

  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
        role: 'SUPER_ADMIN',
        preferences: { create: { theme: 'DARK' } },
      },
      select: { id: true },
    });
    await tx.portalAuditEvent.create({
      data: {
        actorUserId: user.id,
        action: 'owner.bootstrap',
        targetType: 'user',
        targetId: user.id,
        summary: 'Created the initial portal owner account',
      },
    });
  });
  process.stdout.write('Initial Super Admin account created. Remove bootstrap credentials from the environment.\n');
} catch (error) {
  process.stderr.write('Owner bootstrap failed: ' + (error.code ? 'database operation error.' : error.message) + '\n');
  exitCode = 1;
} finally {
  process.env.PORTAL_OWNER_PASSWORD = '';
  await prisma.$disconnect().catch(() => {});
}
process.exitCode = exitCode;
