import test from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/views');
const now = new Date('2026-11-05T09:00:00.000Z');
const user = { id: 'user-1', name: 'Portal Owner', email: 'owner@example.com', role: 'SUPER_ADMIN' };
const project = {
  id: 'project-1',
  slug: 'sample-site-12345678',
  name: 'Sample Site',
  siteUrl: 'https://example.com',
  adminUrl: 'https://example.com/admin',
  faviconUrl: null,
  category: null,
  status: 'UNKNOWN',
  integrationStatus: 'CONFIGURATION_REQUIRED',
  statusMessage: null,
  responseMs: null,
  lastHealthCheckAt: null,
  lastActivityAt: null,
  archivedAt: null,
  createdAt: now,
  integration: { framePolicy: 'NOT_CHECKED', framePolicyMessage: 'Needs review', frameOrigin: null },
  capabilities: [],
  access: [{ canManage: true }],
  _count: { healthChecks: 0, externalAuditEvents: 0 },
};

const base = {
  title: 'Test page',
  error: null,
  value: '',
  csrfToken: 'test-csrf-token',
  currentUser: user,
  active: '',
  currentPath: '/',
  unreadCount: 0,
  portalName: 'Control Portal',
  configuration: null,
  accentColor: '#8b5cf6',
  theme: 'DARK',
  notice: null,
};

const cases = [
  ['layout', { body: '<main>Portal</main>' }],
  ['pages/login', {}],
  ['pages/setup', {}],
  ['pages/error', { message: 'Unavailable', statusCode: 503 }],
  ['pages/dashboard', { stats: { total: 0, online: 0, connected: 0, uptime: '—', measured: 0 }, projects: [], recentEvents: [] }],
  ['pages/projects', {
    projects: [],
    filters: { query: '', status: '', archived: false, view: 'grid', sort: 'newest' },
    pagination: { page: 1, pageSize: 12, total: 0, pages: 1 },
  }],
  ['pages/add-project', {}],
  ['pages/edit-project', { project }],
  ['pages/workspace', { project, canEmbed: false, canManage: true, projectAccess: { canManage: true } }],
  ['pages/project-audit', { project, events: [], query: '' }],
  ['pages/project-activity', { project, events: [] }],
  ['pages/integrations', { projects: [], portalOrigin: 'https://portal.example.com' }],
  ['pages/monitoring', { projects: [] }],
  ['pages/activity', { events: [] }],
  ['pages/notifications', { notifications: [] }],
  ['pages/users', { users: [], projects: [] }],
  ['pages/settings', {
    configuration: { portalName: 'Control Portal', logoUrl: null, accentColor: '#8b5cf6' },
    preference: { theme: 'DARK', notificationSettings: {} },
    sessionCount: 1,
  }],
];

for (const [view, locals] of cases) {
  test('EJS view renders: ' + view, async () => {
    const html = await ejs.renderFile(path.join(root, view + '.ejs'), { ...base, ...locals });
    assert.match(html, /<!doctype html>|<section|<main/);
  });
}

test('project card renders a truthful unverified state and management actions', async () => {
  const html = await ejs.renderFile(path.join(root, 'partials/project-card.ejs'), { ...base, project });
  assert.match(html, /Open Workspace/);
  assert.match(html, /Setup required/);
  assert.match(html, /Archive project/);
});

test('Google sign-in appears only when it is configured', async () => {
  const enabled = await ejs.renderFile(path.join(root, 'pages/login.ejs'), {
    title: 'Sign in', portalName: 'Control Portal', csrfToken: 'csrf', error: null, googleSignInEnabled: true,
  });
  const disabled = await ejs.renderFile(path.join(root, 'pages/login.ejs'), {
    title: 'Sign in', portalName: 'Control Portal', csrfToken: 'csrf', error: null, googleSignInEnabled: false,
  });
  assert.match(enabled, /href="\/auth\/google"/);
  assert.match(enabled, /Continue with Google/);
  assert.doesNotMatch(disabled, /Continue with Google/);
});

test('settings exposes the self-only push test action only when OneSignal is configured', async () => {
  const locals = {
    ...base,
    configuration: { portalName: 'Control Portal', logoUrl: null, accentColor: '#8b5cf6' },
    preference: { theme: 'DARK', notificationSettings: {} },
    sessionCount: 1,
  };
  const enabled = await ejs.renderFile(path.join(root, 'pages/settings.ejs'), { ...locals, oneSignalEnabled: true });
  const disabled = await ejs.renderFile(path.join(root, 'pages/settings.ejs'), { ...locals, oneSignalEnabled: false });
  assert.match(enabled, /data-onesignal-test disabled/);
  assert.match(enabled, /data-onesignal-test-status/);
  assert.doesNotMatch(disabled, /data-onesignal-test/);
});

test('user management presents Developer and User labels for existing permission roles', async () => {
  const users = ['PROJECT_MANAGER', 'VIEWER'].map((role, index) => ({
    id: 'user-' + index,
    name: 'Portal Member ' + index,
    email: 'member' + index + '@example.test',
    role,
    isActive: true,
    createdAt: now,
    projectAccess: [],
  }));
  const html = await ejs.renderFile(path.join(root, 'pages/users.ejs'), {
    ...base,
    users,
    projects: [],
  });
  assert.match(html, /Developer/);
  assert.match(html, /User/);
  assert.match(html, /sign in with Google using this same email address/i);
  assert.doesNotMatch(html, /Temporary password|name="password"/);
  assert.doesNotMatch(html, /Project Manager|Viewer/);
});
