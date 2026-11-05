export function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (!roles.includes(req.user.role)) return res.status(403).render('pages/error', {
      title: 'Access denied',
      message: 'Your portal role does not allow this action.',
      statusCode: 403,
    });
    next();
  };
}

export function canManageAllProjects(user) {
  return user?.role === 'SUPER_ADMIN';
}
export function canManageUsers(user) {
  return user?.role === 'SUPER_ADMIN';
}
