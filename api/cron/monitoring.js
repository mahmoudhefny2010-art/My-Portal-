import { runMonitoringBatch } from '../../src/services/monitoring.service.js';
import { prisma } from '../../src/config/prisma.js';

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  const authorization = req.headers.authorization || '';
  if (!expected || authorization !== 'Bearer ' + expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await runMonitoringBatch(prisma, 20);
    return res.status(200).json({ ok: true, checked: result.checked, remaining: result.remaining });
  } catch {
    return res.status(503).json({ error: 'Monitoring batch unavailable' });
  }
}
