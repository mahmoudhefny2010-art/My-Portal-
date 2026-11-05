import 'dotenv/config';
import app from './app.js';
import { prisma } from './config/prisma.js';

const missing = [];
if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
if (!process.env.DIRECT_URL) missing.push('DIRECT_URL');
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) missing.push('SESSION_SECRET (32+ characters)');
if (!process.env.RATE_LIMIT_SECRET || process.env.RATE_LIMIT_SECRET.length < 32) missing.push('RATE_LIMIT_SECRET (32+ characters)');
if (!/^[a-f0-9]{64}$/i.test(process.env.INTEGRATION_KEY_ENCRYPTION_KEY || '')) missing.push('INTEGRATION_KEY_ENCRYPTION_KEY (64 hex characters)');
if (process.env.NODE_ENV === 'production' && (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 32)) missing.push('CRON_SECRET (32+ characters) in production');
if (process.env.NODE_ENV === 'production') {
  try { if (new URL(process.env.PORTAL_ORIGIN || '').protocol !== 'https:') missing.push('PORTAL_ORIGIN (https://...) in production'); }
  catch { missing.push('PORTAL_ORIGIN (https://...) in production'); }
}

const port = Number(process.env.PORT) || 3000;
const production = process.env.NODE_ENV === 'production';
const listen = (message) => app.listen(port, () => {
  process.stdout.write('Control Portal listening on http://localhost:' + port + '\n');
  if (message) process.stderr.write(message + '\n');
});

if (missing.length && production) {
  process.stderr.write('Control Portal is not configured. Set: ' + missing.join(', ') + '. See .env.example and README.md.\n');
  process.exitCode = 1;
} else if (missing.length) {
  listen('Setup required: ' + missing.join(', ') + '. Open http://localhost:' + port + '/setup after adding your environment settings.');
} else {
  try {
    await prisma.$connect();
    listen();
  } catch {
    if (production) {
      process.stderr.write('Control Portal could not connect to its database. Check DATABASE_URL and network access.\n');
      process.exitCode = 1;
    } else {
      process.env.PORTAL_DATABASE_UNAVAILABLE = '1';
      listen('Database connection failed. Open http://localhost:' + port + '/setup to review the setup steps.');
    }
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
}
