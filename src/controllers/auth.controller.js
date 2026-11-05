import { randomBytes } from 'node:crypto';
import { loginSchema } from '../validators/auth.schema.js';
import { loginRateState, recordLoginAttempt, verifyLogin } from '../services/auth.service.js';
import { recordPortalAudit } from '../services/audit.service.js';
import { isGoogleOAuthConfigured } from '../services/google-auth.service.js';

export function loginPage(_req, res) {
  res.render('pages/login', {
    title: 'Sign in',
    error: null,
    googleSignInEnabled: isGoogleOAuthConfigured(),
  });
}

export async function establishAuthenticatedSession(req, user) {
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  req.session.csrfToken = randomBytes(32).toString('base64url');
  await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
}

export async function login(prisma, req, res, next) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).render('pages/login', {
      title: 'Sign in',
      error: 'Enter a valid email address and password.',
      googleSignInEnabled: isGoogleOAuthConfigured(),
    });
  }

  try {
    const state = await loginRateState(prisma, parsed.data.email, req.ip);
    if (state.blocked) {
      return res.status(429).render('pages/login', {
        title: 'Sign in',
        error: 'Too many attempts. Wait 15 minutes and try again.',
        googleSignInEnabled: isGoogleOAuthConfigured(),
      });
    }

    const user = await verifyLogin(prisma, parsed.data.email, parsed.data.password);
    await recordLoginAttempt(prisma, {
      identityKey: state.identityKey,
      networkKey: state.networkKey,
      succeeded: Boolean(user),
    });

    if (!user) {
      return res.status(401).render('pages/login', {
        title: 'Sign in',
        error: 'The email or password is incorrect.',
        googleSignInEnabled: isGoogleOAuthConfigured(),
      });
    }

    await establishAuthenticatedSession(req, user);
    await recordPortalAudit(prisma, {
      actorUserId: user.id,
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      summary: 'Signed in to the portal',
    });
    return res.redirect('/');
  } catch (error) {
    next(error);
  }
}

export async function logout(prisma, req, res, next) {
  const userId = req.user?.id;
  try {
    if (userId) {
      await recordPortalAudit(prisma, {
        actorUserId: userId,
        action: 'auth.logout',
        targetType: 'user',
        targetId: userId,
        summary: 'Signed out of the portal',
      });
    }
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie('control.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
      res.redirect('/login');
    });
  } catch (error) {
    next(error);
  }
}
