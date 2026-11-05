import { createHash } from 'node:crypto';
import { externalAuditEventSchema, sanitizeChanges } from '../validators/external-event.schema.js';
import { verifyWebhookSignature } from '../services/integration-secret.service.js';
import { notifyAdmins } from '../services/audit.service.js';

function safeValue(value) {
  if (typeof value === 'string') return value.slice(0, 200);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return undefined;
}

export async function receiveAuditEvent(prisma, req, res) {
  if (!Buffer.isBuffer(req.body) || req.body.length > 512 * 1024) {
    return res.status(413).json({ error: 'Event payload is too large.' });
  }
  const timestamp = req.get('x-control-portal-timestamp') || '';
  const suppliedSignature = req.get('x-control-portal-signature') || '';
  const timestampNumber = Number(timestamp);
  const timestampMs = timestamp.length <= 10 ? timestampNumber * 1000 : timestampNumber;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    return res.status(401).json({ error: 'Invalid event signature.' });
  }

  try {
    const project = await prisma.project.findFirst({
      where: { slug: req.params.slug, archivedAt: null },
      select: { id: true, name: true, integration: true },
    });
    if (!project || !verifyWebhookSignature(project.integration, timestamp, req.body, suppliedSignature)) {
      return res.status(401).json({ error: 'Invalid event signature.' });
    }

    let decoded;
    try {
      decoded = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid event payload.' });
    }
    const parsed = externalAuditEventSchema.safeParse(decoded);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid event payload.' });

    const event = parsed.data;
    const changes = sanitizeChanges(event.changes)
      .map((change) => ({
        field: change.field,
        ...(Object.hasOwn(change, 'before') ? { before: safeValue(change.before) } : {}),
        ...(Object.hasOwn(change, 'after') ? { after: safeValue(change.after) } : {}),
      }));
    const actorLabel = event.actor.label?.replace(/[\u0000-\u001f\u007f]/g, '').trim() || null;
    const actorReference = event.actor.id?.replace(/[\u0000-\u001f\u007f]/g, '').trim() || null;
    const happenedAt = new Date(event.occurredAt);
    const summary = (actorLabel ? actorLabel + ' ' : 'A connected administrator ')
      + event.action + ' ' + event.entityType + (event.entityId ? ' (' + event.entityId + ')' : '');
    const details = {
      externalEventId: event.id,
      entityType: event.entityType,
      entityId: event.entityId || null,
      actorLabel,
      severity: event.severity,
      changes,
    };

    try {
      await prisma.$transaction(async (tx) => {
        await tx.externalAuditEventReference.create({
          data: {
            projectId: project.id,
            externalEventId: event.id,
            action: event.action,
            entityType: event.entityType,
            entityId: event.entityId || null,
            actorLabel,
            actorReference,
            severity: event.severity,
            changes,
            happenedAt,
          },
        });
        await tx.portalAuditEvent.create({
          data: {
            projectId: project.id,
            action: 'external.' + event.action.slice(0, 90),
            targetType: event.entityType,
            targetId: event.entityId || null,
            summary: summary.slice(0, 500),
            details,
            source: 'EXTERNAL_WEBHOOK',
          },
        });
        await tx.project.update({
          where: { id: project.id },
          data: { lastActivityAt: new Date() },
        });
        await tx.projectIntegration.update({
          where: { projectId: project.id },
          data: { lastSignedEventAt: new Date(), liveAuditCapability: 'ACTIVE' },
        });
        await tx.integrationCapability.upsert({
          where: { projectId_name: { projectId: project.id, name: 'live-admin-audit-feed' } },
          create: {
            projectId: project.id,
            name: 'live-admin-audit-feed',
            status: 'ACTIVE',
            evidence: 'A valid HMAC-signed server-side event was received.',
            verifiedAt: new Date(),
          },
          update: {
            status: 'ACTIVE',
            evidence: 'A valid HMAC-signed server-side event was received.',
            verifiedAt: new Date(),
          },
        });
      });
    } catch (error) {
      if (error.code === 'P2002') return res.status(202).json({ accepted: true, duplicate: true });
      throw error;
    }

    await notifyAdmins(prisma, {
      projectId: project.id,
      type: 'ADMIN_CHANGE',
      title: 'External admin activity',
      message: project.name + ': ' + summary.slice(0, 410),
    });
    return res.status(202).json({ accepted: true, eventId: createHash('sha256').update(event.id).digest('hex').slice(0, 16) });
  } catch {
    return res.status(503).json({ error: 'Event could not be recorded.' });
  }
}
