import { safeHttpsRequest } from '../security/safe-fetch.js';
import { notifyAdmins } from './audit.service.js';

function measuredStatus(httpStatus) {
  if (httpStatus >= 200 && httpStatus < 500) return 'ONLINE';
  return 'OFFLINE';
}

export async function checkProject(prisma, projectId, { now = new Date() } = {}) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, adminUrl: true, status: true, archivedAt: true, name: true },
  });
  if (!project || project.archivedAt) return null;

  let measurement;
  try {
    const response = await safeHttpsRequest(project.adminUrl, { method: 'HEAD' });
    const status = measuredStatus(response.status);
    measurement = {
      status,
      responseMs: response.durationMs,
      httpStatus: response.status,
      message: response.status >= 500 ? 'The Admin URL returned a server error.' : 'The Admin URL responded to a safe HTTPS check.',
    };
  } catch (error) {
    const message = error.name === 'UnsafeDestinationError'
      ? 'The URL now resolves to a private or reserved address; the check was blocked.'
      : error.code === 'ENOTFOUND'
        ? 'The host could not be resolved.'
        : error.message === 'Connection timed out.'
          ? 'The connection timed out.'
          : 'The Admin URL did not complete a safe HTTPS check.';
    measurement = { status: 'OFFLINE', responseMs: null, httpStatus: null, message };
  }

  const nextCheck = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.projectHealthCheck.create({
      data: { projectId, ...measurement, checkedAt: now },
    }),
    prisma.project.update({
      where: { id: projectId },
      data: {
        status: measurement.status,
        responseMs: measurement.responseMs,
        lastHealthCheckAt: now,
        nextHealthCheckAt: nextCheck,
        statusMessage: measurement.message,
      },
    }),
  ]);

  if (project.status !== measurement.status && project.status !== 'UNKNOWN') {
    await notifyAdmins(prisma, {
      projectId,
      type: measurement.status === 'ONLINE' ? 'PROJECT_ONLINE' : 'PROJECT_OFFLINE',
      title: measurement.status === 'ONLINE' ? 'Project is online' : 'Project is offline',
      message: project.name + ': ' + measurement.message,
    });
  }
  return measurement;
}

export async function runMonitoringBatch(prisma, limit = 20, { now = new Date() } = {}) {
  const due = await prisma.project.findMany({
    where: { archivedAt: null, nextHealthCheckAt: { lte: now } },
    orderBy: [{ nextHealthCheckAt: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true },
  });
  let checked = 0;
  for (const project of due) {
    const claim = await prisma.project.updateMany({
      where: { id: project.id, archivedAt: null, nextHealthCheckAt: { lte: now } },
      data: { nextHealthCheckAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
    });
    if (claim.count) {
      await checkProject(prisma, project.id, { now });
      checked += 1;
    }
  }
  const remaining = await prisma.project.count({
    where: { archivedAt: null, nextHealthCheckAt: { lte: now } },
  });
  return { checked, remaining };
}
