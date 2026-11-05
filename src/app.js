import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prisma } from './config/prisma.js';
import { createPrismaSessionStore } from './config/session-store.js';
import { csrfToken, verifyCsrf } from './middleware/csrf.js';
import portalRoutes from './routes/portal.routes.js';
import { login, loginPage, logout } from './controllers/auth.controller.js';
import { finishGoogleLogin, startGoogleLogin } from './controllers/google-auth.controller.js';
import { receiveAuditEvent } from './controllers/webhook.controller.js';
import { isOneSignalConfigured } from './services/onesignal.service.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const oneSignalWorkerPath = path.resolve(dirname, '../public/push/onesignal/OneSignalSDKWorker.js');
const oneSignalConfigured = isOneSignalConfigured();

function runtimeConfigError() {
  if (!process.env.DATABASE_URL || !process.env.DIRECT_URL) return 'Portal database is not configured.';
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) return 'A strong session secret is not configured.';
  if (!process.env.RATE_LIMIT_SECRET || process.env.RATE_LIMIT_SECRET.length < 32) return 'The login rate-limit secret is not configured.';
  if (!/^[a-f0-9]{64}$/i.test(process.env.INTEGRATION_KEY_ENCRYPTION_KEY || '')) return 'The integration encryption key is not configured.';
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 32) return 'The monitoring cron secret is not configured.';
    try {
      if (new URL(process.env.PORTAL_ORIGIN || '').protocol !== 'https:') return 'The production portal origin must use HTTPS.';
    } catch {
      return 'The production portal origin is not configured.';
    }
  }
  if (process.env.PORTAL_DATABASE_UNAVAILABLE === '1') return 'Portal database is unavailable.';
  return null;
}

const app = express();
app.disable('x-powered-by');
if (process.env.VERCEL === '1') app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      frameSrc: ["'self'"],
      imgSrc: ["'self'", 'https:', 'data:'],
      scriptSrc: ["'self'", ...(oneSignalConfigured ? ['https://cdn.onesignal.com'] : [])],
      connectSrc: ["'self'", ...(oneSignalConfigured ? ['https://onesignal.com', 'https://*.onesignal.com'] : [])],
      styleSrc: ["'self'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use(express.static(path.resolve(dirname, '../public'), {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  dotfiles: 'deny',
  index: false,
  setHeaders(res, filePath) {
    if (oneSignalConfigured && path.resolve(filePath) === oneSignalWorkerPath) {
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.onesignal.com; connect-src 'self' https://onesignal.com https://*.onesignal.com");
    }
  },
}));
app.get('/favicon.ico', (_req, res) => res.status(204).end());

app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));
app.get('/readyz', async (_req, res) => {
  const error = runtimeConfigError();
  if (error) return res.status(503).json({ ready: false, reason: error });
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ ready: true });
  } catch {
    return res.status(503).json({ ready: false, reason: 'Portal database unavailable.' });
  }
});
app.get('/setup', (_req, res) => {
  res.render('pages/setup', {
    title: 'Set up Control Portal',
    csrfToken: '',
    portalName: process.env.PORTAL_NAME || 'Control Portal',
  });
});

app.use(session({
  name: 'control.sid',
  secret: process.env.SESSION_SECRET || randomBytes(48).toString('hex'),
  store: createPrismaSessionStore(prisma),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  },
}));

app.post('/api/projects/:slug/audit-events', express.raw({
  type: 'application/json',
  limit: '512kb',
  verify: (_req, _res, buffer) => {
    if (buffer.length > 512 * 1024) throw new Error('Payload too large.');
  },
}), (req, res) => receiveAuditEvent(prisma, req, res));

app.use(express.urlencoded({ extended: false, limit: '40kb' }));
app.use(express.json({ limit: '40kb' }));
app.use((req, res, next) => {
  res.locals.portalName = process.env.PORTAL_NAME || 'Control Portal';
  res.locals.oneSignalEnabled = oneSignalConfigured;
  res.locals.oneSignalAppId = oneSignalConfigured ? process.env.ONESIGNAL_APP_ID.trim() : '';
  res.locals.theme = 'DARK';
  res.locals.notice = req.session?.notice || null;
  if (req.session?.notice) delete req.session.notice;
  next();
});
app.use(async (req, res, next) => {
  try {
    const configurationError = runtimeConfigError();
    res.locals.configurationError = configurationError;
    if (!configurationError) {
      const configuration = await prisma.portalConfiguration.findUnique({
        where: { id: 'main' },
        select: { portalName: true, logoUrl: true, accentColor: true },
      });
      if (configuration) {
        res.locals.portalConfiguration = configuration;
        res.locals.portalName = configuration.portalName;
      }
    }
    if (req.session?.userId) {
      const user = await prisma.user.findUnique({
        where: { id: req.session.userId },
        select: { id: true, name: true, email: true, role: true, isActive: true },
      });
      if (user?.isActive) {
        req.user = user;
        res.locals.currentUser = user;
        const preference = await prisma.userPreference.findUnique({
          where: { userId: user.id },
          select: { theme: true },
        });
        res.locals.theme = preference?.theme || 'DARK';
        res.locals.unreadCount = await prisma.notification.count({
          where: { readAt: null, OR: [{ userId: user.id }, { userId: null }] },
        });
      } else {
        req.session.destroy(() => {});
      }
    }
    next();
  } catch (error) {
    next(error);
  }
});
app.use(csrfToken);

const publishedDocs = {
  'PORTAL_INTEGRATION.md': path.resolve(dirname, '../docs/PORTAL_INTEGRATION.md'),
  'PROJECT_INTEGRATION_TEMPLATE.json': path.resolve(dirname, '../PROJECT_INTEGRATION_TEMPLATE.json'),
  'FUTURE_PROJECT_PROMPT.md': path.resolve(dirname, '../FUTURE_PROJECT_PROMPT.md'),
};
app.get(['/integration-guide', '/docs/:name'], (req, res, next) => {
  const filename = req.path === '/integration-guide' ? 'PORTAL_INTEGRATION.md' : req.params.name;
  const target = publishedDocs[filename];
  if (!target) return res.status(404).send('Document not found.');
  res.type(filename.endsWith('.json') ? 'application/json' : 'text/markdown');
  res.sendFile(target, (error) => {
    if (error && !res.headersSent) next(error);
  });
});

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  if (res.locals.configurationError) return res.redirect('/setup');
  loginPage(req, res);
});
app.get('/auth/google', startGoogleLogin);
app.get('/auth/google/callback', (req, res, next) => finishGoogleLogin(prisma, req, res, next));
app.post('/login', verifyCsrf, (req, res, next) => {
  if (res.locals.configurationError) return res.redirect('/setup');
  login(prisma, req, res, next);
});
app.post('/logout', verifyCsrf, (req, res, next) => logout(prisma, req, res, next));
app.use('/', portalRoutes);

app.use((_req, res) => res.status(404).render('pages/error', {
  title: 'Page not found',
  message: 'The page you requested does not exist.',
  statusCode: 404,
}));

app.use((error, _req, res, _next) => {
  const status = error.status === 413 ? 413 : 500;
  const message = status === 413
    ? 'This request is larger than the allowed limit.'
    : 'The portal could not complete that request. Check the database and server configuration.';
  if (res.headersSent) return;
  res.status(status).render('pages/error', { title: status === 413 ? 'Request too large' : 'Portal unavailable', message, statusCode: status });
});

export default app;
