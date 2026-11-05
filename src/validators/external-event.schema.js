import { z } from 'zod';

const scalar = z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()]);

export const externalAuditEventSchema = z.object({
  id: z.string().min(1).max(160),
  occurredAt: z.string().datetime(),
  action: z.string().trim().min(1).max(100),
  entityType: z.string().trim().min(1).max(80),
  entityId: z.string().max(160).optional().nullable(),
  severity: z.enum(['INFO', 'SUCCESS', 'WARNING', 'ERROR']).default('INFO'),
  actor: z.object({
    id: z.string().max(160).optional().nullable(),
    label: z.string().trim().max(120).optional().nullable(),
  }).default({}),
  changes: z.array(z.object({
    field: z.string().trim().min(1).max(80),
    before: scalar.optional(),
    after: scalar.optional(),
  }).strict()).max(40).optional().default([]),
}).strict();

const sensitiveField = /(password|secret|token|cookie|authorization|email|phone|address|ssn|card|customer|personal)/i;

export function sanitizeChanges(changes) {
  return changes
    .filter((change) => !sensitiveField.test(change.field))
    .map((change) => ({
      field: change.field,
      ...(Object.hasOwn(change, 'before') ? { before: change.before } : {}),
      ...(Object.hasOwn(change, 'after') ? { after: change.after } : {}),
    }));
}
