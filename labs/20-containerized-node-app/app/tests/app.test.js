import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';

test('GET /health renvoie 200 et { ok: true }', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.deepEqual(res.json(), { ok: true });
  } finally {
    await app.close();
  }
});

test('une route inconnue renvoie 404', async () => {
  const app = await buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/unknown-route' });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, 'Not Found');
  } finally {
    await app.close();
  }
});
