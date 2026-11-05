import { z } from 'zod';

function addHttpsWhenSchemeIsOmitted(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) || trimmed.startsWith('//')) return trimmed;
  return `https://${trimmed}`;
}

export const adminUrlSchema = z.preprocess(addHttpsWhenSchemeIsOmitted,
  z.string().trim().min(1).max(2048).url().superRefine((value, ctx) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') {
        ctx.addIssue({ code: 'custom', message: 'Use a secure https:// Admin URL.' });
      }
      if (url.username || url.password) {
        ctx.addIssue({ code: 'custom', message: 'URLs cannot contain usernames or passwords.' });
      }
      if (url.search || url.hash) {
        ctx.addIssue({ code: 'custom', message: 'Remove query strings and fragments. Do not place tokens in URLs.' });
      }
      if (url.port && url.port !== '443') {
        ctx.addIssue({ code: 'custom', message: 'Only the standard HTTPS port is supported.' });
      }
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid Admin Dashboard URL.' });
    }
  }),
);

export const createProjectSchema = z.object({
  adminUrl: adminUrlSchema,
});

export const editProjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().max(80).optional().transform((value) => value || null),
});

export function normalizeAdminUrl(value) {
  const url = new URL(value);
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
  return url.toString();
}
