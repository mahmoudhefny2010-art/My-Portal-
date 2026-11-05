import { randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const oauthSessionSchema = z.object({
  state: z.string().min(32).max(128),
  nonce: z.string().min(32).max(128),
  codeVerifier: z.string().min(43).max(128),
  createdAt: z.number().int().positive(),
});

const googleIdentitySchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  email_verified: z.union([z.literal(true), z.literal('true')]),
  nonce: z.string().min(1).max(128),
});

function constantTimeMatches(expected, supplied) {
  if (typeof expected !== 'string' || typeof supplied !== 'string') return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export function resolveGoogleOAuthConfig(env = process.env) {
  const clientId = String(env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;

  let portalOrigin;
  try {
    portalOrigin = new URL(env.PORTAL_ORIGIN || 'http://localhost:3000');
  } catch {
    return null;
  }

  const isLocalHttp = portalOrigin.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(portalOrigin.hostname);
  if (portalOrigin.protocol !== 'https:' && !isLocalHttp) return null;
  if (portalOrigin.username || portalOrigin.password || portalOrigin.search || portalOrigin.hash) return null;

  return {
    clientId,
    clientSecret,
    redirectUri: new URL('/auth/google/callback', portalOrigin.origin).toString(),
  };
}

export function isGoogleOAuthConfigured(env = process.env) {
  return Boolean(resolveGoogleOAuthConfig(env));
}

export function createGoogleOAuthClient(config = resolveGoogleOAuthConfig()) {
  if (!config) return null;
  return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
}

export async function createGoogleOAuthChallenge(oauthClient, now = Date.now()) {
  const { codeVerifier, codeChallenge } = await oauthClient.generateCodeVerifierAsync();
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const authorizationUrl = oauthClient.generateAuthUrl({
    scope: ['openid', 'email'],
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });

  return {
    authorizationUrl,
    session: { state, nonce, codeVerifier, createdAt: now },
  };
}

export function validateGoogleOAuthState(sessionValue, suppliedState, now = Date.now()) {
  const parsed = oauthSessionSchema.safeParse(sessionValue);
  if (!parsed.success) return false;
  const age = now - parsed.data.createdAt;
  return age >= 0 && age <= OAUTH_STATE_TTL_MS
    && constantTimeMatches(parsed.data.state, suppliedState);
}

export function validateGoogleIdentity(payload, expectedNonce) {
  const parsed = googleIdentitySchema.safeParse(payload);
  if (!parsed.success || !constantTimeMatches(parsed.data.nonce, expectedNonce)) return null;
  return { googleSubject: parsed.data.sub, email: parsed.data.email };
}
