import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import WebSocket from 'ws';

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WebSocket;
}

const adapter = process.env.DATABASE_URL
  ? new PrismaNeon({ connectionString: process.env.DATABASE_URL })
  : undefined;

const options = {
  ...(adapter ? { adapter } : {}),
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
};

export const prisma = globalThis.__controlPortalPrisma || new PrismaClient(options);

if (process.env.NODE_ENV !== 'production') {
  globalThis.__controlPortalPrisma = prisma;
}
