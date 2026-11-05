import { randomBytes, timingSafeEqual } from 'node:crypto';

export function csrfToken(req, res, next) {
  if (req.session && !res.locals.configurationError && !req.session.csrfToken
    && req.path !== '/setup' && req.path !== '/healthz' && req.path !== '/readyz') {
    req.session.csrfToken = randomBytes(32).toString('base64url');
  }
  res.locals.csrfToken = req.session?.csrfToken || '';
  next();
}

export function verifyCsrf(req, res, next) {
  const expected = req.session?.csrfToken || '';
  const supplied = req.body?._csrf || req.get('x-csrf-token') || '';
  const left = Buffer.from(expected);
  const right = Buffer.from(String(supplied));
  if (!expected || left.length !== right.length || !timingSafeEqual(left, right)) {
    return res.status(403).render('pages/error', {
      title: 'Request expired',
      message: 'Refresh the page and try again.',
      statusCode: 403,
    });
  }
  next();
}
