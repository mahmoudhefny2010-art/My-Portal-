import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

test('PWA manifest has installable PNG icons in the required sizes', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');

  for (const size of [192, 512]) {
    const icon = manifest.icons.find((entry) => entry.sizes === `${size}x${size}`);
    assert.ok(icon, `missing ${size}px icon manifest entry`);
    const png = fs.readFileSync(path.join(root, icon.src.slice(1)));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

test('PWA service worker keeps private pages and API responses out of its cache', () => {
  const serviceWorker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
  assert.match(serviceWorker, /request\.mode === 'navigate'[\s\S]*?fetch\(request\)\.catch\(\(\) => caches\.match\('\/offline\.html'\)\)/);
  assert.match(serviceWorker, /if \(!STATIC_ASSETS\.includes\(url\.pathname\)\) return/);
  assert.doesNotMatch(serviceWorker, /STATIC_ASSETS\s*=\s*\[[^\]]*['"]\/(?:login|api|projects|settings)/s);
});
