import { canManageAllProjects } from './auth.js';

export function requireProjectAccess(prisma, { manage = false, includeArchived = false } = {}) {
  return async (req, res, next) => {
    try {
      const project = await prisma.project.findFirst({
        where: { slug: req.params.slug, ...(includeArchived ? {} : { archivedAt: null }) },
        include: {
          integration: true,
          capabilities: { orderBy: { name: 'asc' } },
          _count: { select: { healthChecks: true, externalAuditEvents: true } },
        },
      });
      if (!project) return res.status(404).render('pages/error', {
        title: 'Project not found',
        message: 'This project may have been removed or archived.',
        statusCode: 404,
      });

      if (!canManageAllProjects(req.user)) {
        const access = await prisma.projectAccess.findUnique({
          where: { userId_projectId: { userId: req.user.id, projectId: project.id } },
        });
        if (!access || (manage && !access.canManage)) {
          return res.status(403).render('pages/error', {
            title: 'Project access required',
            message: 'You do not have permission to access this project.',
            statusCode: 403,
          });
        }
        req.projectAccess = access;
      } else {
        req.projectAccess = { canManage: true };
      }
      req.project = project;
      next();
    } catch {
      next(new Error('Project lookup failed.'));
    }
  };
}
