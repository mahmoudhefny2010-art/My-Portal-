import session from 'express-session';

export function createPrismaSessionStore(prisma) {
  return new (class PrismaSessionStore extends session.Store {
    get(sid, callback) {
      prisma.portalSession.findUnique({ where: { sid } })
        .then(async (record) => {
          if (!record || record.expiresAt <= new Date()) {
            if (record) await prisma.portalSession.deleteMany({ where: { sid } });
            return callback(null, null);
          }
          callback(null, record.data);
        })
        .catch(() => callback(new Error('Session storage unavailable')));
    }

    set(sid, sessionData, callback = () => {}) {
      const expiresAt = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires)
        : new Date(Date.now() + 8 * 60 * 60 * 1000);
      prisma.portalSession.upsert({
        where: { sid },
        create: { sid, data: sessionData, expiresAt, userId: sessionData.userId || null },
        update: { data: sessionData, expiresAt, userId: sessionData.userId || null },
      }).then(() => callback(null)).catch(() => callback(new Error('Session storage unavailable')));
    }

    destroy(sid, callback = () => {}) {
      prisma.portalSession.deleteMany({ where: { sid } })
        .then(() => callback(null))
        .catch(() => callback(new Error('Session storage unavailable')));
    }

    touch(sid, sessionData, callback = () => {}) {
      const expiresAt = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires)
        : new Date(Date.now() + 8 * 60 * 60 * 1000);
      prisma.portalSession.updateMany({
        where: { sid },
        data: { expiresAt, userId: sessionData.userId || null },
      })
        .then(() => callback(null))
        .catch(() => callback(new Error('Session storage unavailable')));
    }
  })();
}
