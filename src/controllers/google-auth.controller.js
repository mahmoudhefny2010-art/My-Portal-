import { z } from 'zod';
import { establishAuthenticatedSession } from './auth.controller.js';
import { recordPortalAudit } from '../services/audit.service.js';
import {
  createGoogleOAuthChallenge,
  createGoogleOAuthClient,
  isGoogleOAuthConfigured,
  resolveGoogleOAuthConfig,
  validateGoogleIdentity,
  validateGoogleOAuthState,
} from '../services/google-auth.service.js';

const callbackQuerySchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(32).max(128).optional(),
  error: z.string().min(1).max(128).optional(),
});

function renderLoginError(res, error, statusCode = 401) {
  return res.status(statusCode).render('pages/login', {
    title: 'Sign in',
    error,
    googleSignInEnabled: isGoogleOAuthConfigured(),
  });
}

function saveSession(session) {
  return new Promise((resolve, reject) => {
    session.save((error) => error ? reject(error) : resolve());
  });
}

async function findOrLinkPortalUser(prisma, identity) {
  const linkedIdentity = await prisma.googleIdentity.findUnique({
    where: { googleSubject: identity.googleSubject },
    include: { user: { select: { id: true, isActive: true } } },
  });
  if (linkedIdentity) return linkedIdentity.user;

  const user = await prisma.user.findUnique({
    where: { email: identity.email },
    select: { id: true, isActive: true },
  });
  if (!user?.isActive) return null;

  try {
    await prisma.googleIdentity.create({
      data: { googleSubject: identity.googleSubject, userId: user.id },
    });
    return user;
  } catch (error) {
    if (error.code !== 'P2002') throw error;
    const racedIdentity = await prisma.googleIdentity.findUnique({
      where: { googleSubject: identity.googleSubject },
      include: { user: { select: { id: true, isActive: true } } },
    });
    return racedIdentity?.user || null;
  }
}

export async function startGoogleLogin(req, res, next) {
  const config = resolveGoogleOAuthConfig();
  if (!config) return renderLoginError(res, 'Google sign-in is not configured yet.', 503);

  try {
    const oauthClient = createGoogleOAuthClient(config);
    const challenge = await createGoogleOAuthChallenge(oauthClient);
    req.session.googleOAuth = challenge.session;
    await saveSession(req.session);
    return res.redirect(challenge.authorizationUrl);
  } catch (error) {
    return next(error);
  }
}

export async function finishGoogleLogin(prisma, req, res, next) {
  const challenge = req.session?.googleOAuth;
  const parsedQuery = callbackQuerySchema.safeParse(req.query);
  if (!parsedQuery.success || !validateGoogleOAuthState(challenge, parsedQuery.data.state)) {
    if (req.session) delete req.session.googleOAuth;
    return renderLoginError(res, 'Google sign-in expired. Start again from this page.', 400);
  }

  if (req.session) delete req.session.googleOAuth;
  if (parsedQuery.data.error) {
    return renderLoginError(res, 'Google sign-in was canceled. You can try again.', 401);
  }
  if (!parsedQuery.data.code) {
    return renderLoginError(res, 'Google did not complete sign-in. Try again.', 400);
  }

  const config = resolveGoogleOAuthConfig();
  if (!config) return renderLoginError(res, 'Google sign-in is not configured yet.', 503);

  try {
    const oauthClient = createGoogleOAuthClient(config);
    const { tokens } = await oauthClient.getToken({
      code: parsedQuery.data.code,
      codeVerifier: challenge.codeVerifier,
    });
    if (!tokens.id_token) return renderLoginError(res, 'Google sign-in could not be verified. Try again.');

    const ticket = await oauthClient.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId });
    const identity = validateGoogleIdentity(ticket.getPayload(), challenge.nonce);
    if (!identity) return renderLoginError(res, 'Google sign-in could not be verified. Try again.');

    const user = await findOrLinkPortalUser(prisma, identity);
    if (!user?.isActive) {
      return renderLoginError(res, 'No active portal account is linked to this Google account. Contact your portal administrator.');
    }

    await establishAuthenticatedSession(req, user);
    await recordPortalAudit(prisma, {
      actorUserId: user.id,
      action: 'auth.google-login',
      targetType: 'user',
      targetId: user.id,
      summary: 'Signed in to the portal with Google',
    });
    return res.redirect('/');
  } catch (error) {
    if (error.code === 'P2021' || error.code === 'P2022') {
      return renderLoginError(res, 'Google sign-in is not ready until the database migration is applied.', 503);
    }
    return next(error);
  }
}
