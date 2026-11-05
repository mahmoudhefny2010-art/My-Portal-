import { randomUUID } from 'node:crypto';
import { inspectAdminUrl } from './project-probe.service.js';
import { normalizeAdminUrl } from '../validators/project.schema.js';
import { recordPortalAudit } from './audit.service.js';
import { UnsafeDestinationError } from '../security/network.js';

const INITIAL_CAPABILITIES = [
  ['secure-embedding', 'CONFIGURATION_REQUIRED', 'Admin framing policy and authenticated workflows have not been fully verified.'],
  ['live-admin-audit-feed', 'CONFIGURATION_REQUIRED', 'The client application must emit signed server-side audit events.'],
  ['live-data-sync', 'CONFIGURATION_REQUIRED', 'The client application must expose an authorized event or refresh mechanism.'],
  ['optimistic-concurrency', 'CONFIGURATION_REQUIRED', 'The client application must enforce record versions or ETags on writes.'],
];

function slugify(value) {
  const base = value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72);
  return (base || 'project') + '-' + randomUUID().slice(0, 8);
}

export async function createProject(prisma, { adminUrl, actorUserId }) {
  const normalizedUrl = normalizeAdminUrl(adminUrl);
  const siteUrl = new URL(normalizedUrl).origin;
  let inspection = null;
  let probeError = null;

  try {
    inspection = await inspectAdminUrl(normalizedUrl);
  } catch (error) {
    if (error instanceof UnsafeDestinationError) throw error;
    probeError = error.code === 'ENOTFOUND'
      ? 'The host could not be resolved yet. The project is registered and can be checked again later.'
      : error.message === 'Connection timed out.'
        ? 'The Admin URL did not respond before the safe connection timeout. The project is registered for later checks.'
        : 'The Admin URL could not be checked safely. The project is registered for later checks.';
  }

  const name = inspection?.title || new URL(normalizedUrl).hostname;
  const initialStatus = inspection
    ? (inspection.reachable ? 'ONLINE' : 'OFFLINE')
    : 'UNKNOWN';
  const statusMessage = inspection
    ? (inspection.httpStatus >= 400
      ? 'The URL responded with HTTP ' + inspection.httpStatus + '. Dashboard authentication and functionality are not verified.'
      : 'The URL responded with HTTP ' + inspection.httpStatus + '. Dashboard authentication and functionality are not verified.')
    : probeError;
  const framePolicy = inspection?.framePolicy || {
    code: 'NOT_CHECKED',
    message: probeError || 'No response policy was available to inspect.',
  };

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        slug: slugify(name),
        name,
        siteUrl,
        adminUrl: normalizedUrl,
        faviconUrl: inspection?.faviconUrl || null,
        status: initialStatus,
        integrationStatus: 'CONFIGURATION_REQUIRED',
        statusMessage,
        responseMs: inspection?.durationMs ?? null,
        lastHealthCheckAt: inspection ? new Date() : null,
        nextHealthCheckAt: new Date(Date.now() + (inspection ? 24 : 0) * 60 * 60 * 1000),
        createdById: actorUserId,
        integration: {
          create: {
            framePolicy: framePolicy.code,
            framePolicyMessage: framePolicy.message,
          },
        },
        access: { create: { userId: actorUserId, canManage: true } },
        capabilities: {
          create: INITIAL_CAPABILITIES.map(([name, status, evidence]) => ({ name, status, evidence })),
        },
      },
    });

    if (inspection) {
      await tx.projectHealthCheck.create({
        data: {
          projectId: project.id,
          status: initialStatus,
          responseMs: inspection.durationMs,
          httpStatus: inspection.httpStatus,
          message: statusMessage,
        },
      });
      await tx.integrationVerification.create({
        data: {
          projectId: project.id,
          outcome: framePolicy.code,
          reason: framePolicy.message,
          httpStatus: inspection.httpStatus,
          framePolicy: framePolicy.code,
          durationMs: inspection.durationMs,
        },
      });
    }

    await recordPortalAudit(tx, {
      actorUserId,
      projectId: project.id,
      action: 'project.created',
      targetType: 'project',
      targetId: project.id,
      summary: 'Added project ' + project.name,
      details: { integrationStatus: project.integrationStatus, framePolicy: framePolicy.code },
    });
    return project;
  });
}

export async function updateProject(prisma, project, { name, category }, actorUserId) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id: project.id },
      data: { name, category },
    });
    await recordPortalAudit(tx, {
      actorUserId,
      projectId: project.id,
      action: 'project.updated',
      targetType: 'project',
      targetId: project.id,
      summary: 'Updated project details for ' + updated.name,
      details: { nameChanged: project.name !== name, categoryChanged: project.category !== category },
    });
    return updated;
  });
}

export async function archiveProject(prisma, project, actorUserId, archived) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id: project.id },
      data: { archivedAt: archived ? new Date() : null },
    });
    await recordPortalAudit(tx, {
      actorUserId,
      projectId: project.id,
      action: archived ? 'project.archived' : 'project.restored',
      targetType: 'project',
      targetId: project.id,
      summary: (archived ? 'Archived ' : 'Restored ') + project.name,
    });
    return updated;
  });
}
