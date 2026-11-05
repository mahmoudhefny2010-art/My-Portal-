import { PrismaClient } from '@prisma/client';

const options = {
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
};

export const prisma = globalThis.__controlPortalPrisma || new PrismaClient(options);

if (process.env.NODE_ENV !== 'production') {
  globalThis.__controlPortalPrisma = prisma;
}
