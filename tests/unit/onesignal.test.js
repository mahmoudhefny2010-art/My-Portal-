import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { notifyAdmins } from '../../src/services/audit.service.js';
import { sendOneSignalPush } from '../../src/services/onesignal.service.js';

const envNames = ['ONESIGNAL_APP_ID', 'ONESIGNAL_REST_API_KEY', 'PORTAL_ORIGIN'];
const userA = '10000000-0000-4000-8000-000000000001';
const userB = '10000000-0000-4000-8000-000000000002';

function preserveEnvironment(t) {
  const original = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    for (const name of envNames) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
    globalThis.fetch = originalFetch;
  });
}

test('notifyAdmins persists alerts and pushes only to users with the event enabled', async (t) => {
  preserveEnvironment(t);
  process.env.ONESIGNAL_APP_ID = '12345678-1234-4234-8234-123456789abc';
  process.env.ONESIGNAL_REST_API_KEY = 'test-only-server-key';
  process.env.PORTAL_ORIGIN = 'https://portal.example.test';

  const operations = [];
  let storedRows;
  let fetchRequest;
  const prisma = {
    user: {
      findMany: async ({ where }) => {
        assert.equal(where.isActive, true);
        return [
          { id: userA, preferences: null },
          { id: userB, preferences: { notificationSettings: { PROJECT_OFFLINE: false } } },
        ];
      },
    },
    notification: {
      createMany: async ({ data }) => {
        operations.push('database');
        storedRows = data;
        return { count: data.length };
      },
    },
  };
  globalThis.fetch = async (url, options) => {
    operations.push('onesignal');
    fetchRequest = { url, options };
    return { ok: true, status: 200 };
  };

  const result = await notifyAdmins(prisma, {
    projectId: '20000000-0000-4000-8000-000000000001',
    type: 'PROJECT_OFFLINE',
    title: 'Project offline',
    message: 'A project needs attention.',
  });

  assert.equal(result.count, 1);
  assert.deepEqual(operations, ['database', 'onesignal']);
  assert.deepEqual(storedRows.map((row) => row.userId), [userA]);
  assert.equal(fetchRequest.url, 'https://api.onesignal.com/notifications');
  assert.equal(fetchRequest.options.headers.Authorization, 'Key test-only-server-key');
  const payload = JSON.parse(fetchRequest.options.body);
  assert.deepEqual(payload.include_aliases, { external_id: [userA] });
  assert.equal(payload.target_channel, 'push');
  assert.equal(payload.url, 'https://portal.example.test/notifications');
  assert.equal(JSON.stringify(payload).includes('test-only-server-key'), false);
});

test('test push reports OneSignal acceptance and only targets the requested account', async (t) => {
  preserveEnvironment(t);
  process.env.ONESIGNAL_APP_ID = '12345678-1234-4234-8234-123456789abc';
  process.env.ONESIGNAL_REST_API_KEY = 'test-only-server-key';
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ id: 'notification-id', recipients: 1 }) };
  };

  const result = await sendOneSignalPush({
    userIds: [userA],
    title: 'Control Portal test notification',
    message: 'Browser notifications are connected.',
  });

  assert.deepEqual(result, { ok: true, recipients: 1 });
  assert.equal(request.url, 'https://api.onesignal.com/notifications');
  const payload = JSON.parse(request.options.body);
  assert.deepEqual(payload.include_aliases, { external_id: [userA] });
  assert.equal(payload.target_channel, 'push');
});

test('test push reports server rejection without exposing response details', async (t) => {
  preserveEnvironment(t);
  process.env.ONESIGNAL_APP_ID = '12345678-1234-4234-8234-123456789abc';
  process.env.ONESIGNAL_REST_API_KEY = 'test-only-server-key';
  globalThis.fetch = async () => ({ ok: false, status: 401 });
  const originalWarn = console.warn;
  console.warn = () => {};
  t.after(() => { console.warn = originalWarn; });

  const result = await sendOneSignalPush({ userIds: [userA], title: 'Test', message: 'Test' });
  assert.deepEqual(result, { ok: false, reason: 'http_error', status: 401 });
});

test('OneSignal connection failure explains origin setup and lets the user retry', async () => {
  const source = await readFile(new URL('../../public/js/onesignal.js', import.meta.url), 'utf8');
  const listeners = {};
  const status = { textContent: '' };
  const toggle = {
    textContent: 'Checking…',
    disabled: true,
    addEventListener: (event, handler) => { listeners[event] = handler; },
  };
  let reloads = 0;
  let initOptions;
  const window = {
    OneSignalDeferred: [],
    location: {
      hostname: 'localhost',
      origin: 'http://localhost:3000',
      reload: () => { reloads += 1; },
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  const document = {
    body: { dataset: { onesignalAppId: 'app-id', onesignalUserId: 'user-id' } },
    querySelector: (selector) => selector === '[data-onesignal-status]'
      ? status
      : selector === '[data-onesignal-toggle]' ? toggle : null,
  };

  vm.runInNewContext(source, { window, document });
  await window.OneSignalDeferred[0]({
    init: async (options) => {
      initOptions = options;
      throw new Error('setup failed');
    },
  });

  assert.equal(initOptions.serviceWorkerPath, '/push/onesignal/OneSignalSDKWorker.js');
  assert.equal(initOptions.serviceWorkerParam.scope, '/push/onesignal/');
  assert.equal(initOptions.allowLocalhostAsSecureOrigin, true);
  assert.match(status.textContent, /http:\/\/localhost:3000/);
  assert.match(status.textContent, /Site URL/);
  assert.match(status.textContent, /OneSignalSDKWorker\.js/);
  assert.equal(toggle.textContent, 'Retry connection');
  assert.equal(toggle.disabled, false);
  await listeners.click();
  assert.equal(reloads, 1);
});

test('browser test notification uses CSRF and reports OneSignal acknowledgement', async () => {
  const source = await readFile(new URL('../../public/js/onesignal.js', import.meta.url), 'utf8');
  const listeners = {};
  const status = { textContent: '' };
  const toggle = { textContent: '', disabled: true, addEventListener: (event, handler) => { listeners.toggle = handler; } };
  const testButton = { textContent: '', disabled: true, addEventListener: (event, handler) => { listeners.test = handler; } };
  const testStatus = { textContent: '' };
  let request;
  const window = {
    OneSignalDeferred: [],
    Notification: { permission: 'granted' },
    location: { hostname: 'localhost', origin: 'http://localhost:3000', reload() {} },
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  const document = {
    body: { dataset: { onesignalAppId: 'app-id', onesignalUserId: userA } },
    querySelector: (selector) => ({
      '[data-onesignal-status]': status,
      '[data-onesignal-toggle]': toggle,
      '[data-onesignal-test]': testButton,
      '[data-onesignal-test-status]': testStatus,
      'meta[name="csrf-token"]': { content: 'test-csrf-token' },
      'form[action="/logout"]': null,
    })[selector] ?? null,
  };
  const fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ ok: true, recipients: 1 }) };
  };

  vm.runInNewContext(source, { window, document, fetch });
  await window.OneSignalDeferred[0]({
    init: async () => {},
    login: async () => {},
    Notifications: { isPushSupported: () => true },
    User: { PushSubscription: { optedIn: true, addEventListener() {} } },
  });
  assert.equal(testButton.disabled, false);
  await listeners.test();

  assert.equal(request.url, '/settings/notifications/test');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['x-csrf-token'], 'test-csrf-token');
  assert.match(testStatus.textContent, /OneSignal accepted the test request/);
  assert.match(testStatus.textContent, /1 recipient/);
});

test('OneSignal deferred initialization is queued before the remote SDK loads', async () => {
  const layout = await readFile(new URL('../../src/views/layout.ejs', import.meta.url), 'utf8');
  const bootstrapPosition = layout.indexOf('<script src="/js/onesignal.js" defer></script>');
  const sdkPosition = layout.indexOf('<script src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js" defer></script>');

  assert.notEqual(bootstrapPosition, -1);
  assert.notEqual(sdkPosition, -1);
  assert.ok(bootstrapPosition < sdkPosition);
});
