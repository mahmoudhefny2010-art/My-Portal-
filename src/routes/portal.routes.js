import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { prisma as defaultPrisma } from '../config/prisma.js';
import { requireAuth, requireRoles } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/project-access.js';
import { createProjectSchema, editProjectSchema } from '../validators/project.schema.js';
import { createUserSchema } from '../validators/auth.schema.js';
import { createProject, updateProject, archiveProject } from '../services/project.service.js';
import { checkProject } from '../services/monitoring.service.js';
import { inspectAdminUrl } from '../services/project-probe.service.js';
import { UnsafeDestinationError } from '../security/network.js';
import { rotateWebhookSecret } from '../services/integration-secret.service.js';
import { hashPassword, hashUnusablePassword, verifyPassword } from '../services/auth.service.js';
import { recordPortalAudit } from '../services/audit.service.js';
import { receiveAuditEvent } from '../controllers/webhook.controller.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { isOneSignalConfigured, sendOneSignalPush } from '../services/onesignal.service.js';

const router = Router();
const themeSchema = z.object({ theme: z.enum(['DARK', 'LIGHT', 'SYSTEM']) });
const settingSchema = z.object({
  portalName: z.string().trim().min(2).max(120),
  logoUrl: z.union([z.literal(''), z.string().url().max(2048)]).optional().default(''),
  accentColor: z.enum(['#8b5cf6', '#2563eb', '#0891b2', '#db2777']),
});
const createUserInput = createUserSchema;
const accessSchema = z.object({ projectIds: z.array(z.string().uuid()).max(500).default([]) });
const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(128),
  confirmPassword: z.string().min(12).max(128),
}).refine((value) => value.newPassword === value.confirmPassword, {
  message: 'The new password confirmation does not match.',
  path: ['confirmPassword'],
});
const notificationTypes = [
  'PROJECT_OFFLINE', 'PROJECT_ONLINE', 'INTEGRATION_FAILED', 'INTEGRATION_CONNECTED',
  'ADMIN_CHANGE', 'SECURITY_WARNING', 'AUDIT_INTEGRATION_FAILURE', 'SYNCHRONIZATION_FAILURE',
];
const notificationSettingsSchema = z.object({ enabledTypes: z.array(z.enum(notificationTypes)).default([]) });

function renderPage(req, res, view, data = {}) {
  const page = {
    ...data,
    title: data.title || 'Control Portal',
    error: data.error || null,
    value: data.value || '',
    oneSignalEnabled: res.locals.oneSignalEnabled || false,
    oneSignalAppId: res.locals.oneSignalAppId || '',
  };
  res.render(view, page, (error, body) => {
    if (error) return res.status(500).send('The page could not be rendered.');
    res.render('layout', {
      ...page,
      body,
      currentUser: req.user || null,
      active: data.active || '',
      currentPath: req.path,
      unreadCount: res.locals.unreadCount || 0,
      portalName: res.locals.portalName,
      configuration: res.locals.portalConfiguration || page.configuration || null,
      accentColor: (res.locals.portalConfiguration || page.configuration || {}).accentColor || '#8b5cf6',
      theme: res.locals.theme || 'DARK',
      csrfToken: res.locals.csrfToken || '',
      notice: res.locals.notice || null,
      oneSignalEnabled: page.oneSignalEnabled,
      oneSignalAppId: page.oneSignalAppId,
    }, (layoutError, html) => {
      if (layoutError) return res.status(500).send('The page could not be rendered.');
      res.send(html);
    });
  });
}

function projectScope(user) {
  return user.role === 'SUPER_ADMIN'
    ? {}
    : { access: { some: { userId: user.id } } };
}

function flash(req, type, message) {
  req.session.notice = { type, message };
}

async function markIntegrationUnverified(prisma, projectId, { code, message, outcome = code }) {
  const at = new Date();
  await prisma.$transaction([
    prisma.projectIntegration.upsert({
      where: { projectId },
      create: {
        projectId,
        framePolicy: code,
        framePolicyMessage: message,
        embeddingVerifiedAt: null,
        authenticationVerifiedAt: null,
        embeddingVerifiedById: null,
        frameOrigin: null,
      },
      update: {
        framePolicy: code,
        framePolicyMessage: message,
        embeddingVerifiedAt: null,
        authenticationVerifiedAt: null,
        embeddingVerifiedById: null,
        frameOrigin: null,
      },
    }),
    prisma.project.update({
      where: { id: projectId },
      data: { integrationStatus: 'CONFIGURATION_REQUIRED' },
    }),
    prisma.integrationVerification.create({
      data: { projectId, outcome, reason: message, framePolicy: code, verifiedAt: at },
    }),
    prisma.integrationCapability.upsert({
      where: { projectId_name: { projectId, name: 'secure-embedding' } },
      create: { projectId, name: 'secure-embedding', status: 'CONFIGURATION_REQUIRED', evidence: message },
      update: { status: 'CONFIGURATION_REQUIRED', evidence: message, verifiedAt: null },
    }),
  ]);
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const where = { archivedAt: null, ...projectScope(req.user) };
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [total, online, connected, checks, projects] = await Promise.all([
      defaultPrisma.project.count({ where }),
      defaultPrisma.project.count({ where: { ...where, status: 'ONLINE' } }),
      defaultPrisma.project.count({ where: { ...where, integrationStatus: 'VERIFIED' } }),
      defaultPrisma.projectHealthCheck.groupBy({
        by: ['status'],
        where: { checkedAt: { gte: since }, project: where },
        _count: { _all: true },
      }),
      defaultPrisma.project.findMany({
        where,
        orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
        take: 6,
        include: {
          access: req.user.role === 'SUPER_ADMIN' ? true : { where: { userId: req.user.id }, select: { canManage: true } },
        },
      }),
    ]);
    const totalChecks = checks.reduce((sum, group) => sum + group._count._all, 0);
    const onlineChecks = checks.find((group) => group.status === 'ONLINE')?._count._all || 0;
    const uptime = totalChecks ? ((onlineChecks / totalChecks) * 100).toFixed(1) + '%' : '—';
    return renderPage(req, res, 'pages/dashboard', {
      title: 'Dashboard',
      active: 'dashboard',
      stats: { total, online, connected, uptime, measured: totalChecks },
      projects,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/projects', requireAuth, async (req, res, next) => {
  try {
    const query = String(req.query.search || '').trim().slice(0, 100);
    const status = ['ONLINE', 'OFFLINE', 'MAINTENANCE', 'UNKNOWN'].includes(req.query.status) ? req.query.status : '';
    const archived = req.query.archived === '1';
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    const view = req.query.view === 'list' ? 'list' : 'grid';
    const where = {
      ...projectScope(req.user),
      archivedAt: archived ? { not: null } : null,
      ...(status ? { status } : {}),
      ...(query ? { OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { siteUrl: { contains: query, mode: 'insensitive' } },
        { adminUrl: { contains: query, mode: 'insensitive' } },
      ] } : {}),
    };
    const pageSize = 12;
    const [total, projects] = await Promise.all([
      defaultPrisma.project.count({ where }),
      defaultPrisma.project.findMany({
        where,
        orderBy: { createdAt: req.query.sort === 'oldest' ? 'asc' : 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          integration: true,
          _count: { select: { healthChecks: true } },
          access: req.user.role === 'SUPER_ADMIN' ? true : { where: { userId: req.user.id }, select: { canManage: true } },
        },
      }),
    ]);
    return renderPage(req, res, 'pages/projects', {
      title: archived ? 'Archived projects' : 'My Projects',
      active: 'projects',
      projects,
      filters: { query, status, archived, view, sort: req.query.sort === 'oldest' ? 'oldest' : 'newest' },
      pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/projects/new', requireAuth, requireRoles('SUPER_ADMIN', 'ADMIN'), (req, res) => {
  renderPage(req, res, 'pages/add-project', { title: 'Add Project', active: 'add-project' });
});

router.post('/projects', requireAuth, requireRoles('SUPER_ADMIN', 'ADMIN'), async (req, res, next) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return renderPage(req, res, 'pages/add-project', {
      title: 'Add Project',
      active: 'add-project',
      error: parsed.error.issues[0]?.message || 'Enter a valid HTTPS Admin URL.',
      value: req.body.adminUrl,
    });
  }
  try {
    const project = await createProject(defaultPrisma, {
      adminUrl: parsed.data.adminUrl,
      actorUserId: req.user.id,
    });
    flash(req, 'success', 'Project added. Its dashboard and integration capabilities still need verification.');
    return res.redirect('/projects/' + project.slug + '/workspace');
  } catch (error) {
    if (error instanceof UnsafeDestinationError) {
      return renderPage(req, res, 'pages/add-project', {
        title: 'Add Project',
        active: 'add-project',
        error: 'This host resolves to a private or reserved network address, so the portal blocked the request.',
        value: req.body.adminUrl,
      });
    }
    if (error.code === 'P2002') {
      return renderPage(req, res, 'pages/add-project', {
        title: 'Add Project',
        active: 'add-project',
        error: 'That Admin URL is already registered.',
        value: req.body.adminUrl,
      });
    }
    next(error);
  }
});

router.get('/projects/:slug/workspace', requireAuth, requireProjectAccess(defaultPrisma), (req, res) => {
  const integration = req.project.integration;
  const canEmbed = Boolean(integration?.embeddingVerifiedAt && integration?.authenticationVerifiedAt
    && integration?.framePolicy === 'POLICY_ALLOWS');
  if (canEmbed) {
    let origin;
    try {
      origin = new URL(integration.frameOrigin || req.project.adminUrl).origin;
      if (!origin.startsWith('https://')) throw new Error('invalid origin');
    } catch {
      return res.status(409).render('pages/error', {
        title: 'Embedding needs review',
        message: 'The verified frame origin is invalid. Run a fresh integration check.',
        statusCode: 409,
      });
    }
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "frame-src 'self' " + origin,
      "img-src 'self' https: data:",
      "script-src 'self'",
      "style-src 'self'",
      "object-src 'none'",
    ].join('; '));
  }
  renderPage(req, res, 'pages/workspace', {
    title: req.project.name + ' workspace',
    active: 'projects',
    project: req.project,
    canEmbed,
    canManage: req.projectAccess.canManage,
  });
});

router.get('/projects/:slug/edit', requireAuth, requireProjectAccess(defaultPrisma, { manage: true }), (req, res) => {
  renderPage(req, res, 'pages/edit-project', {
    title: 'Edit ' + req.project.name,
    active: 'projects',
    project: req.project,
  });
});

router.post('/projects/:slug/edit', requireAuth, requireProjectAccess(defaultPrisma, { manage: true }), async (req, res, next) => {
  const parsed = editProjectSchema.safeParse(req.body);
  if (!parsed.success) return renderPage(req, res, 'pages/edit-project', {
    title: 'Edit ' + req.project.name,
    active: 'projects',
    project: req.project,
    error: 'Enter a project name and a category under 80 characters.',
  });
  try {
    await updateProject(defaultPrisma, req.project, parsed.data, req.user.id);
    flash(req, 'success', 'Project details saved.');
    res.redirect('/projects/' + req.params.slug + '/workspace');
  } catch (error) {
    next(error);
  }
});

router.post('/projects/:slug/archive', requireAuth, requireProjectAccess(defaultPrisma, { manage: true, includeArchived: true }), async (req, res, next) => {
  try {
    const archived = !req.project.archivedAt;
    await archiveProject(defaultPrisma, req.project, req.user.id, archived);
    flash(req, 'success', archived ? 'Project archived. Its original website and database were not changed.' : 'Project restored.');
    res.redirect(archived ? '/projects' : '/projects?archived=1');
  } catch (error) {
    next(error);
  }
});

router.post('/projects/:slug/remove', requireAuth, requireRoles('SUPER_ADMIN'), requireProjectAccess(defaultPrisma, { manage: true }), async (req, res, next) => {
  if (req.body.confirmName !== req.project.name) {
    flash(req, 'error', 'Type the exact project name to remove its portal record.');
    return res.redirect('/projects/' + req.params.slug + '/workspace');
  }
  try {
    await defaultPrisma.$transaction(async (tx) => {
      await recordPortalAudit(tx, {
        actorUserId: req.user.id,
        projectId: req.project.id,
        action: 'project.removed',
        targetType: 'project',
        targetId: req.project.id,
        summary: 'Removed portal record for ' + req.project.name,
      });
      await tx.project.delete({ where: { id: req.project.id } });
    });
    flash(req, 'success', 'The project was removed from this portal. The original website and database were not touched.');
    res.redirect('/projects');
  } catch (error) {
    next(error);
  }
});

router.get('/projects/:slug/audit', requireAuth, requireProjectAccess(defaultPrisma), async (req, res, next) => {
  try {
    const query = String(req.query.search || '').trim().slice(0, 100);
    const events = await defaultPrisma.externalAuditEventReference.findMany({
      where: {
        projectId: req.project.id,
        ...(query ? { OR: [
          { action: { contains: query, mode: 'insensitive' } },
          { actorLabel: { contains: query, mode: 'insensitive' } },
          { entityType: { contains: query, mode: 'insensitive' } },
        ] } : {}),
      },
      orderBy: { happenedAt: 'desc' },
      take: 100,
    });
    renderPage(req, res, 'pages/project-audit', {
      title: req.project.name + ' audit log',
      active: 'projects',
      project: req.project,
      events,
      query,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/projects/:slug/activity', requireAuth, requireProjectAccess(defaultPrisma), async (req, res, next) => {
  try {
    const events = await defaultPrisma.portalAuditEvent.findMany({
      where: { projectId: req.project.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { actor: { select: { name: true } } },
    });
    renderPage(req, res, 'pages/project-activity', {
      title: req.project.name + ' portal activity',
      active: 'projects',
      project: req.project,
      events,
    });
  } catch (error) { next(error); }
});

router.get('/api/projects/:slug/audit-events', requireAuth, requireProjectAccess(defaultPrisma), async (req, res, next) => {
  const since = z.string().datetime().safeParse(req.query.since);
  if (!since.success) return res.status(400).json({ error: 'A valid since timestamp is required.' });
  try {
    const events = await defaultPrisma.externalAuditEventReference.findMany({
      where: { projectId: req.project.id, receivedAt: { gt: new Date(since.data) } },
      orderBy: { receivedAt: 'asc' },
      take: 20,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ events: events.map((event) => ({
      eventId: event.externalEventId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      actorLabel: event.actorLabel,
      severity: event.severity,
      changes: event.changes,
      happenedAt: event.happenedAt.toISOString(),
      receivedAt: event.receivedAt.toISOString(),
    })) });
  } catch (error) { next(error); }
});

router.post('/projects/:slug/check', requireAuth, requireProjectAccess(defaultPrisma, { manage: true }), async (req, res, next) => {
  try {
    const measurement = await checkProject(defaultPrisma, req.project.id);
    flash(req, measurement?.status === 'ONLINE' ? 'success' : 'warning',
      measurement?.message || 'The project could not be checked.');
    res.redirect(req.get('referer')?.startsWith('/') ? req.get('referer') : '/projects/' + req.params.slug + '/workspace');
  } catch (error) {
    next(error);
  }
});

router.get('/integrations', requireAuth, async (req, res, next) => {
  try {
    const projects = await defaultPrisma.project.findMany({
      where: { archivedAt: null, ...projectScope(req.user) },
      orderBy: { name: 'asc' },
      include: {
        integration: true,
        capabilities: { orderBy: { name: 'asc' } },
        access: req.user.role === 'SUPER_ADMIN' ? true : { where: { userId: req.user.id }, select: { canManage: true } },
      },
    });
    renderPage(req, res, 'pages/integrations', {
      title: 'Integration Manager',
      active: 'integrations',
      projects,
      portalOrigin: process.env.PORTAL_ORIGIN || '',
    });
  } catch (error) {
    next(error);
  }
});

router.post('/projects/:slug/integration/check', requireAuth, requireProjectAccess(defaultPrisma, { manage: true }), async (req, res, next) => {
  try {
    let inspection;
    try {
      inspection = await inspectAdminUrl(req.project.adminUrl);
    } catch (error) {
      if (error instanceof UnsafeDestinationError) throw error;
      await markIntegrationUnverified(defaultPrisma, req.project.id, {
        code: 'NOT_CHECKED',
        outcome: 'CHECK_FAILED',
        message: 'The endpoint did not complete a safe HTTPS check. Embedding and authentication need a fresh review.',
      });
      flash(req, 'warning', 'The project was saved, but the endpoint could not be checked. Its embedding and authentication remain unverified.');
      return res.redirect('/integrations');
    }
    const operations = [
      defaultPrisma.projectIntegration.upsert({
        where: { projectId: req.project.id },
        create: {
          projectId: req.project.id,
          framePolicy: inspection.framePolicy.code,
          framePolicyMessage: inspection.framePolicy.message,
          frameOrigin: new URL(inspection.finalUrl).origin,
        },
        update: {
          framePolicy: inspection.framePolicy.code,
          framePolicyMessage: inspection.framePolicy.message,
          frameOrigin: new URL(inspection.finalUrl).origin,
          ...(inspection.framePolicy.code !== 'POLICY_ALLOWS' ? {
            embeddingVerifiedAt: null,
            authenticationVerifiedAt: null,
          } : {}),
        },
      }),
      defaultPrisma.integrationVerification.create({
        data: {
          projectId: req.project.id,
          outcome: inspection.framePolicy.code,
          reason: inspection.framePolicy.message,
          httpStatus: inspection.httpStatus,
          framePolicy: inspection.framePolicy.code,
          durationMs: inspection.durationMs,
        },
      }),
    ];
    if (inspection.framePolicy.code !== 'POLICY_ALLOWS') {
      operations.push(defaultPrisma.project.update({
        where: { id: req.project.id },
        data: { integrationStatus: 'CONFIGURATION_REQUIRED' },
      }));
    }
    await defaultPrisma.$transaction(operations);
    flash(req, inspection.framePolicy.code === 'POLICY_ALLOWS' ? 'success' : 'warning', inspection.framePolicy.message);
    res.redirect('/integrations');
  } catch (error) {
    if (error instanceof UnsafeDestinationError) {
      await markIntegrationUnverified(defaultPrisma, req.project.id, {
        code: 'BLOCKED',
        outcome: 'BLOCKED',
        message: 'The destination now resolves to a private or reserved address; the check was blocked.',
      });
      flash(req, 'error', 'The destination resolves to a private or reserved address. The check was blocked.');
      return res.redirect('/integrations');
    }
    next(error);
  }
});

router.post('/projects/:slug/integration/verify-embedding', requireAuth, requireProjectAccess(defaultPrisma, { manage: true }), async (req, res, next) => {
  if (req.body.confirmation !== 'on' || req.project.integration?.framePolicy !== 'POLICY_ALLOWS') {
    flash(req, 'error', 'The destination must explicitly allow portal framing, and you must complete the browser workflow review.');
    return res.redirect('/integrations');
  }
  try {
    const at = new Date();
    await defaultPrisma.$transaction([
      defaultPrisma.projectIntegration.update({
        where: { projectId: req.project.id },
        data: {
          embeddingVerifiedAt: at,
          authenticationVerifiedAt: at,
          embeddingVerifiedById: req.user.id,
        },
      }),
      defaultPrisma.project.update({
        where: { id: req.project.id },
        data: { integrationStatus: 'VERIFIED' },
      }),
      defaultPrisma.integrationCapability.upsert({
        where: { projectId_name: { projectId: req.project.id, name: 'secure-embedding' } },
        create: {
          projectId: req.project.id,
          name: 'secure-embedding',
          status: 'READY',
          evidence: 'Frame policy checked; authorized owner attested login, navigation, forms, and write permissions.',
          verifiedAt: at,
        },
        update: {
          status: 'READY',
          evidence: 'Frame policy checked; authorized owner attested login, navigation, forms, and write permissions.',
          verifiedAt: at,
        },
      }),
    ]);
    await recordPortalAudit(defaultPrisma, {
      actorUserId: req.user.id,
      projectId: req.project.id,
      action: 'integration.embedding-owner-verified',
      targetType: 'project',
      targetId: req.project.id,
      summary: 'Owner attested secure dashboard embedding for ' + req.project.name,
      details: { verificationMethod: 'owner-attestation' },
    });
    flash(req, 'success', 'Embedding marked ready from your browser review. The attestation and verification time are recorded.');
    res.redirect('/integrations');
  } catch (error) {
    next(error);
  }
});

router.post('/projects/:slug/integration/rotate-secret', requireAuth, requireProjectAccess(defaultPrisma, { manage: true }), async (req, res, next) => {
  try {
    const secret = await rotateWebhookSecret(defaultPrisma, req.project.id);
    await recordPortalAudit(defaultPrisma, {
      actorUserId: req.user.id,
      projectId: req.project.id,
      action: 'integration.webhook-secret-rotated',
      targetType: 'project',
      targetId: req.project.id,
      summary: 'Rotated the signed audit-event secret for ' + req.project.name,
    });
    res.status(201).json({
      secret,
      endpoint: (process.env.PORTAL_ORIGIN || req.protocol + '://' + req.get('host'))
        + '/api/projects/' + req.params.slug + '/audit-events',
    });
  } catch (error) {
    if (error.message.includes('encryption key')) {
      return res.status(503).json({ error: 'Webhook secret setup is unavailable until the server encryption key is configured.' });
    }
    next(error);
  }
});

router.get('/monitoring', requireAuth, async (req, res, next) => {
  try {
    const projects = await defaultPrisma.project.findMany({
      where: { archivedAt: null, ...projectScope(req.user) },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { healthChecks: true } },
        access: req.user.role === 'SUPER_ADMIN' ? true : { where: { userId: req.user.id }, select: { canManage: true } },
      },
    });
    renderPage(req, res, 'pages/monitoring', { title: 'Monitoring', active: 'monitoring', projects });
  } catch (error) {
    next(error);
  }
});

router.post('/monitoring/check-all', requireAuth, requireRoles('SUPER_ADMIN', 'ADMIN'), async (req, res, next) => {
  try {
    const visible = await defaultPrisma.project.findMany({
      where: { archivedAt: null, ...projectScope(req.user) },
      select: { id: true },
      take: 20,
    });
    let checked = 0;
    for (const project of visible) {
      const result = await checkProject(defaultPrisma, project.id);
      if (result) checked += 1;
    }
    flash(req, 'success', 'Completed safe checks for ' + checked + ' projects.');
    res.redirect('/monitoring');
  } catch (error) {
    next(error);
  }
});

router.get('/activity', requireAuth, async (req, res, next) => {
  try {
    const events = await defaultPrisma.portalAuditEvent.findMany({
      where: {
        OR: [
          { projectId: null },
          { project: { archivedAt: null, ...projectScope(req.user) } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { actor: { select: { name: true, role: true } }, project: { select: { name: true, slug: true } } },
    });
    renderPage(req, res, 'pages/activity', { title: 'Activity Logs', active: 'activity', events });
  } catch (error) {
    next(error);
  }
});

router.get('/notifications', requireAuth, async (req, res, next) => {
  try {
    const notifications = await defaultPrisma.notification.findMany({
      where: { OR: [{ userId: req.user.id }, { userId: null }] },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { project: { select: { name: true, slug: true } } },
    });
    renderPage(req, res, 'pages/notifications', { title: 'Notifications', active: 'notifications', notifications });
  } catch (error) {
    next(error);
  }
});

router.post('/notifications/:id/read', requireAuth, async (req, res, next) => {
  try {
    await defaultPrisma.notification.updateMany({
      where: { id: req.params.id, OR: [{ userId: req.user.id }, { userId: null }] },
      data: { readAt: new Date() },
    });
    res.redirect('/notifications');
  } catch (error) {
    next(error);
  }
});

router.post('/notifications/read-all', requireAuth, async (req, res, next) => {
  try {
    await defaultPrisma.notification.updateMany({
      where: { OR: [{ userId: req.user.id }, { userId: null }], readAt: null },
      data: { readAt: new Date() },
    });
    flash(req, 'success', 'Notifications marked as read.');
    res.redirect('/notifications');
  } catch (error) {
    next(error);
  }
});

router.get('/users', requireAuth, requireRoles('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const [users, projects] = await Promise.all([
      defaultPrisma.user.findMany({
        orderBy: { createdAt: 'asc' },
        include: { projectAccess: { include: { project: { select: { id: true, name: true } } } } },
      }),
      defaultPrisma.project.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ]);
    renderPage(req, res, 'pages/users', { title: 'Users & Permissions', active: 'users', users, projects });
  } catch (error) {
    next(error);
  }
});

router.post('/users', requireAuth, requireRoles('SUPER_ADMIN'), async (req, res, next) => {
  const parsed = createUserInput.safeParse(req.body);
  if (!parsed.success) {
    const [users, projects] = await Promise.all([
      defaultPrisma.user.findMany({ orderBy: { createdAt: 'asc' }, include: { projectAccess: { include: { project: true } } } }),
      defaultPrisma.project.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' } }),
    ]);
    return renderPage(req, res, 'pages/users', {
      title: 'Users & Permissions', active: 'users', users, projects,
      error: parsed.error.issues[0]?.message || 'Check the new user details.',
    });
  }
  try {
    const passwordHash = await hashUnusablePassword();
    const user = await defaultPrisma.user.create({
      data: { name: parsed.data.name, email: parsed.data.email, passwordHash, role: parsed.data.role },
    });
    await recordPortalAudit(defaultPrisma, {
      actorUserId: req.user.id,
      action: 'user.created',
      targetType: 'user',
      targetId: user.id,
      summary: 'Created portal user ' + user.name,
      details: { role: user.role },
    });
    flash(req, 'success', 'User created. Ask them to sign in with Google using this email address.');
    res.redirect('/users');
  } catch (error) {
    if (error.code === 'P2002') {
      const [users, projects] = await Promise.all([
        defaultPrisma.user.findMany({ orderBy: { createdAt: 'asc' }, include: { projectAccess: { include: { project: true } } } }),
        defaultPrisma.project.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' } }),
      ]);
      return renderPage(req, res, 'pages/users', { title: 'Users & Permissions', active: 'users', users, projects, error: 'That email address is already registered.' });
    }
    next(error);
  }
});

router.post('/users/:id/role', requireAuth, requireRoles('SUPER_ADMIN'), async (req, res, next) => {
  const role = z.enum(['ADMIN', 'PROJECT_MANAGER', 'VIEWER']).safeParse(req.body.role);
  if (!role.success || req.params.id === req.user.id) {
    flash(req, 'error', 'The account role could not be changed.');
    return res.redirect('/users');
  }
  try {
    const changed = await defaultPrisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { id: req.params.id, role: { not: 'SUPER_ADMIN' } },
        data: { role: role.data },
      });
      if (!result.count) return false;
      await tx.projectAccess.updateMany({
        where: { userId: req.params.id },
        data: { canManage: role.data !== 'VIEWER' },
      });
      await recordPortalAudit(tx, {
        actorUserId: req.user.id, action: 'user.role-changed', targetType: 'user', targetId: req.params.id,
        summary: 'Changed a portal user role', details: { role: role.data },
      });
      return true;
    });
    if (!changed) flash(req, 'error', 'Super Admin accounts cannot be changed from this screen.');
    res.redirect('/users');
  } catch (error) { next(error); }
});

router.post('/users/:id/status', requireAuth, requireRoles('SUPER_ADMIN'), async (req, res, next) => {
  const activeResult = z.enum(['true', 'false']).safeParse(req.body.active);
  if (!activeResult.success || req.params.id === req.user.id) {
    flash(req, 'error', 'You cannot deactivate your own active Super Admin account.');
    return res.redirect('/users');
  }
  const active = activeResult.data === 'true';
  try {
    const changed = await defaultPrisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { id: req.params.id, role: { not: 'SUPER_ADMIN' } },
        data: { isActive: active },
      });
      if (!result.count) return false;
      if (!active) await tx.portalSession.deleteMany({ where: { userId: req.params.id } });
      await recordPortalAudit(tx, {
        actorUserId: req.user.id,
        action: active ? 'user.activated' : 'user.deactivated',
        targetType: 'user',
        targetId: req.params.id,
        summary: active ? 'Activated a portal user' : 'Deactivated a portal user',
      });
      return true;
    });
    if (!changed) flash(req, 'error', 'Super Admin accounts cannot be changed from this screen.');
    res.redirect('/users');
  } catch (error) { next(error); }
});

router.post('/users/:id/access', requireAuth, requireRoles('SUPER_ADMIN'), async (req, res, next) => {
  const parsed = accessSchema.safeParse({ projectIds: Array.isArray(req.body.projectIds) ? req.body.projectIds : req.body.projectIds ? [req.body.projectIds] : [] });
  if (!parsed.success) {
    flash(req, 'error', 'Choose valid project permissions.');
    return res.redirect('/users');
  }
  try {
    const existing = await defaultPrisma.project.findMany({
      where: { id: { in: parsed.data.projectIds }, archivedAt: null },
      select: { id: true },
    });
    if (existing.length !== parsed.data.projectIds.length) {
      flash(req, 'error', 'One or more selected projects are unavailable.');
      return res.redirect('/users');
    }
    await defaultPrisma.$transaction(async (tx) => {
      const targetUser = await tx.user.findUnique({ where: { id: req.params.id }, select: { role: true } });
      if (!targetUser) throw new Error('User not found.');
      await tx.projectAccess.deleteMany({ where: { userId: req.params.id } });
      if (existing.length) {
        await tx.projectAccess.createMany({
          data: existing.map((project) => ({
            userId: req.params.id,
            projectId: project.id,
            canManage: targetUser.role !== 'VIEWER',
          })),
        });
      }
    });
    await recordPortalAudit(defaultPrisma, {
      actorUserId: req.user.id, action: 'user.project-access-updated', targetType: 'user', targetId: req.params.id,
      summary: 'Updated project access for a portal user', details: { projectCount: existing.length },
    });
    flash(req, 'success', 'Project permissions saved.');
    res.redirect('/users');
  } catch (error) { next(error); }
});

router.get('/settings', requireAuth, async (req, res, next) => {
  try {
    const [configuration, preference, sessionCount] = await Promise.all([
      defaultPrisma.portalConfiguration.upsert({
        where: { id: 'main' },
        create: { id: 'main', portalName: process.env.PORTAL_NAME || 'Control Portal' },
        update: {},
      }),
      defaultPrisma.userPreference.upsert({
        where: { userId: req.user.id },
        create: { userId: req.user.id },
        update: {},
      }),
      defaultPrisma.portalSession.count({ where: { userId: req.user.id } }),
    ]);
    renderPage(req, res, 'pages/settings', {
      title: 'Settings', active: 'settings', configuration, preference, sessionCount,
    });
  } catch (error) { next(error); }
});

router.post('/settings', requireAuth, requireRoles('SUPER_ADMIN'), async (req, res, next) => {
  const parsed = settingSchema.safeParse(req.body);
  if (!parsed.success) {
    const [configuration, preference] = await Promise.all([
      defaultPrisma.portalConfiguration.findUnique({ where: { id: 'main' } }),
      defaultPrisma.userPreference.findUnique({ where: { userId: req.user.id } }),
    ]);
    return renderPage(req, res, 'pages/settings', {
      title: 'Settings', active: 'settings', configuration, preference, error: 'Check the portal name and logo URL.',
    });
  }
  const logoUrl = parsed.data.logoUrl || null;
  if (logoUrl && new URL(logoUrl).protocol !== 'https:') {
    flash(req, 'error', 'The portal logo URL must use HTTPS.');
    return res.redirect('/settings');
  }
  try {
    const configuration = await defaultPrisma.portalConfiguration.upsert({
      where: { id: 'main' },
      create: { id: 'main', ...parsed.data, logoUrl },
      update: { ...parsed.data, logoUrl },
    });
    await recordPortalAudit(defaultPrisma, {
      actorUserId: req.user.id,
      action: 'settings.portal-updated',
      targetType: 'portal',
      targetId: 'main',
      summary: 'Updated portal settings',
    });
    flash(req, 'success', 'Portal settings saved.');
    res.locals.portalName = configuration.portalName;
    res.redirect('/settings');
  } catch (error) { next(error); }
});

router.post('/settings/password', requireAuth, async (req, res, next) => {
  const parsed = passwordChangeSchema.safeParse(req.body);
  if (!parsed.success) {
    flash(req, 'error', parsed.error.issues[0]?.message || 'Choose a stronger password.');
    return res.redirect('/settings');
  }
  try {
    const user = await defaultPrisma.user.findUnique({
      where: { id: req.user.id },
      select: { passwordHash: true },
    });
    if (!user || !await verifyPassword(user.passwordHash, parsed.data.currentPassword)) {
      flash(req, 'error', 'The current password is incorrect.');
      return res.redirect('/settings');
    }
    const passwordHash = await hashPassword(parsed.data.newPassword);
    await defaultPrisma.$transaction([
      defaultPrisma.user.update({ where: { id: req.user.id }, data: { passwordHash } }),
      defaultPrisma.portalSession.deleteMany({ where: { userId: req.user.id, sid: { not: req.sessionID } } }),
    ]);
    await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
    req.session.userId = req.user.id;
    req.session.csrfToken = randomBytes(32).toString('base64url');
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    await recordPortalAudit(defaultPrisma, {
      actorUserId: req.user.id,
      action: 'auth.password-changed',
      targetType: 'user',
      targetId: req.user.id,
      summary: 'Changed portal password and revoked other sessions',
    });
    flash(req, 'success', 'Password updated. Other active sessions have been signed out.');
    res.redirect('/settings');
  } catch (error) { next(error); }
});

router.post('/settings/sessions/revoke-others', requireAuth, async (req, res, next) => {
  try {
    const result = await defaultPrisma.portalSession.deleteMany({
      where: { userId: req.user.id, sid: { not: req.sessionID } },
    });
    await recordPortalAudit(defaultPrisma, {
      actorUserId: req.user.id,
      action: 'auth.sessions-revoked',
      targetType: 'user',
      targetId: req.user.id,
      summary: 'Revoked other portal sessions',
      details: { sessionCount: result.count },
    });
    flash(req, 'success', result.count + ' other session(s) signed out.');
    res.redirect('/settings');
  } catch (error) { next(error); }
});

router.post('/settings/notifications', requireAuth, async (req, res, next) => {
  const values = Array.isArray(req.body.enabledTypes)
    ? req.body.enabledTypes
    : req.body.enabledTypes ? [req.body.enabledTypes] : [];
  const parsed = notificationSettingsSchema.safeParse({ enabledTypes: values });
  if (!parsed.success) {
    flash(req, 'error', 'The notification preferences could not be saved.');
    return res.redirect('/settings');
  }
  try {
    const notificationSettings = Object.fromEntries(notificationTypes.map((type) => [type, parsed.data.enabledTypes.includes(type)]));
    await defaultPrisma.userPreference.upsert({
      where: { userId: req.user.id },
      create: { userId: req.user.id, notificationSettings },
      update: { notificationSettings },
    });
    flash(req, 'success', 'Notification preferences saved.');
    res.redirect('/settings');
  } catch (error) { next(error); }
});

router.post('/settings/notifications/test', requireAuth, verifyCsrf, async (req, res, next) => {
  if (!isOneSignalConfigured()) {
    return res.status(503).json({ ok: false, error: 'Browser push is not configured on the server.' });
  }

  const now = Date.now();
  const lastTestAt = Number(req.session.oneSignalTestSentAt || 0);
  if (now - lastTestAt < 30_000) {
    return res.status(429).json({ ok: false, error: 'Wait 30 seconds before sending another test notification.' });
  }
  req.session.oneSignalTestSentAt = now;

  try {
    const result = await sendOneSignalPush({
      userIds: [req.user.id],
      title: 'Control Portal test notification',
      message: 'Browser notifications are connected to your portal account.',
    });
    if (!result.ok) {
      const status = result.reason === 'not_configured' ? 503 : 502;
      return res.status(status).json({ ok: false, error: 'OneSignal could not accept the test notification. Check its server settings and try again.' });
    }
    return res.json({ ok: true, recipients: result.recipients });
  } catch (error) {
    next(error);
  }
});

router.post('/api/preferences/theme', requireAuth, async (req, res, next) => {
  const parsed = themeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose dark, light, or system theme.' });
  try {
    const preference = await defaultPrisma.userPreference.upsert({
      where: { userId: req.user.id },
      create: { userId: req.user.id, theme: parsed.data.theme },
      update: { theme: parsed.data.theme },
      select: { theme: true },
    });
    res.json({ theme: preference.theme });
  } catch (error) { next(error); }
});

export default router;
export { receiveAuditEvent };
