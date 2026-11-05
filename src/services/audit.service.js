import { sendOneSignalPush } from './onesignal.service.js';

export async function recordPortalAudit(prisma, { actorUserId = null, projectId = null, action, targetType, targetId = null, summary, details = null, source = 'PORTAL' }) {
  return prisma.portalAuditEvent.create({
    data: { actorUserId, projectId, action, targetType, targetId, summary, details, source },
  });
}

export async function notifyAdmins(prisma, { projectId = null, type, title, message }) {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      ...(projectId ? {
        OR: [
          { role: 'SUPER_ADMIN' },
          { projectAccess: { some: { projectId } } },
        ],
      } : {}),
    },
    select: { id: true, preferences: { select: { notificationSettings: true } } },
  });
  const recipients = users.filter((user) => user.preferences?.notificationSettings?.[type] !== false);
  const data = recipients
    .map((user) => ({
      userId: user.id,
      projectId,
      type,
      title: title.slice(0, 140),
      message: message.slice(0, 500),
    }));
  if (!data.length) return { count: 0 };
  const result = await prisma.notification.createMany({ data });
  await sendOneSignalPush({
    userIds: recipients.map((user) => user.id),
    title: title.slice(0, 140),
    message: message.slice(0, 500),
  });
  return result;
}
