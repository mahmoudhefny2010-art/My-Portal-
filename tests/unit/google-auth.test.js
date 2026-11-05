import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGoogleOAuthChallenge,
  createGoogleOAuthClient,
  isGoogleOAuthConfigured,
  resolveGoogleOAuthConfig,
  validateGoogleIdentity,
  validateGoogleOAuthState,
} from '../../src/services/google-auth.service.js';

const oauthSession = {
  state: 's'.repeat(43),
  nonce: 'n'.repeat(43),
  codeVerifier: 'v'.repeat(43),
  createdAt: 1_000_000,
};

test('Google OAuth config derives the exact callback from the portal origin', () => {
  const env = {
    GOOGLE_CLIENT_ID: 'portal-client.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    PORTAL_ORIGIN: 'https://portal.example.test',
  };
  assert.equal(resolveGoogleOAuthConfig(env).redirectUri, 'https://portal.example.test/auth/google/callback');
  assert.equal(isGoogleOAuthConfigured(env), true);
  assert.equal(isGoogleOAuthConfigured({ ...env, PORTAL_ORIGIN: 'http://portal.example.test' }), false);
  assert.equal(isGoogleOAuthConfigured({ ...env, GOOGLE_CLIENT_SECRET: '' }), false);
});

test('Google OAuth challenge includes state, nonce, and S256 PKCE', async () => {
  const client = createGoogleOAuthClient({
    clientId: 'portal-client.apps.googleusercontent.com',
    clientSecret: 'test-client-secret',
    redirectUri: 'https://portal.example.test/auth/google/callback',
  });
  const result = await createGoogleOAuthChallenge(client, 1_000_000);
  const authUrl = new URL(result.authorizationUrl);
  assert.equal(authUrl.origin, 'https://accounts.google.com');
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authUrl.searchParams.get('code_challenge')?.length, 43);
  assert.equal(authUrl.searchParams.get('nonce'), result.session.nonce);
  assert.equal(authUrl.searchParams.get('state'), result.session.state);
  assert.equal(authUrl.searchParams.get('redirect_uri'), 'https://portal.example.test/auth/google/callback');
  assert.equal(authUrl.searchParams.get('scope'), 'openid email');
  assert.equal(authUrl.searchParams.has('code_verifier'), false);
  assert.equal(result.session.createdAt, 1_000_000);
});

test('Google callback state is one-time data with a ten minute lifetime', () => {
  assert.equal(validateGoogleOAuthState(oauthSession, oauthSession.state, 1_000_001), true);
  assert.equal(validateGoogleOAuthState(oauthSession, 'wrong-state', 1_000_001), false);
  assert.equal(validateGoogleOAuthState(oauthSession, oauthSession.state, 1_600_001), false);
  assert.equal(validateGoogleOAuthState(oauthSession, oauthSession.state, 999_999), false);
  assert.equal(validateGoogleOAuthState(null, oauthSession.state, 1_000_001), false);
});

test('Google identity requires a verified email and the original nonce', () => {
  const identity = validateGoogleIdentity({
    sub: 'google-account-subject',
    email: 'Portal.User@example.test',
    email_verified: true,
    nonce: oauthSession.nonce,
  }, oauthSession.nonce);
  assert.deepEqual(identity, {
    googleSubject: 'google-account-subject',
    email: 'portal.user@example.test',
  });

  assert.equal(validateGoogleIdentity({
    sub: 'google-account-subject',
    email: 'portal.user@example.test',
    email_verified: false,
    nonce: oauthSession.nonce,
  }, oauthSession.nonce), null);
  assert.equal(validateGoogleIdentity({
    sub: 'google-account-subject',
    email: 'portal.user@example.test',
    email_verified: true,
    nonce: 'wrong-nonce',
  }, oauthSession.nonce), null);
});
