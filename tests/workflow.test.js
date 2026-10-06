'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, verifyPassword } = require('../server');

async function setup(t, existingDir) {
  const dir = existingDir || fs.mkdtempSync(path.join(os.tmpdir(), 'kalman-node-'));
  const model = createApp({ dataDir: dir, testing: true });
  const server = await new Promise(resolve => { const s = model.app.listen(0, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = '', csrf = '';
  const request = async (url, options = {}) => {
    const r = await fetch(origin + url, { redirect: 'manual', ...options, headers: { cookie, ...(options.headers || {}) } });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return r;
  };
  const page = async url => {
    const r = await request(url), text = await r.text();
    csrf = text.match(/name="csrf" value="([^"]+)"/)?.[1] || csrf;
    return { status: r.status, text };
  };
  const post = (url, values = {}, includeCsrf = true) => request(url, { method: 'POST', body: new URLSearchParams({ ...(includeCsrf ? { csrf } : {}), ...values }) });
  const login = async (username = 'admin', password = 'Kalman@123') => {
    await page('/login'); const r = await post('/login', { username, password });
    assert.equal(r.status, 302); await page('/');
  };
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); model.close(); if (!existingDir) fs.rmSync(dir, { recursive: true, force: true }); });
  return { ...model, dir, origin, request, page, post, login, token: () => csrf };
}
test('complete complaint, evidence, custody and report workflow', async t => {
  const a = await setup(t);
  assert.equal((await a.request('/')).status, 302);
  await a.login();
  for (const url of ['/', '/evidence', '/officers', '/account', '/complaints/new', '/complaints/1/edit', '/complaints/1/print']) assert.equal((await a.page(url)).status, 200, url);
  const created = await a.post('/complaints/new', { name: 'Citizen', phone: '1234567890', title: 'Test theft', description: 'Incident', category: 'Theft', location: 'Library', officer_id: '2' });
  assert.equal(created.status, 302); const casePath = created.headers.get('location');
  for (const tab of ['overview', 'evidence', 'custody', 'history']) assert.equal((await a.page(casePath + '?tab=' + tab)).status, 200, tab);
  assert.equal((await a.post(casePath + '/edit', { name: 'Citizen', phone: '1234567890', title: 'Corrected title', description: 'Correction', category: 'Theft', location: 'Library 2' })).status, 302);
  const form = new FormData();
  for (const [key, value] of Object.entries({ csrf: a.token(), label: 'Receipt', kind: 'Document', location: 'Locker A', officer_id: '2' })) form.set(key, value);
  form.set('file', new Blob(['sample evidence']), 'receipt.txt');
  assert.equal((await a.request(casePath + '/evidence', { method: 'POST', body: form })).status, 302);
  const eid = a.db.prepare('SELECT MAX(id) id FROM evidence').get().id;
  assert.equal(await (await a.request(`/evidence/${eid}/download`)).text(), 'sample evidence');
  assert.equal((await a.post(`/evidence/${eid}/transfer`, { officer_id: '3', location: 'Lab', purpose: 'Examination' })).status, 302);
  assert.match((await a.page(casePath + '?tab=evidence')).text, /Vikram Singh/);
  assert.match((await a.page('/evidence')).text, /Lab/);
  assert.equal((await a.post(casePath + '/status', { status: 'Investigating', note: 'Started', officer_id: '2' })).status, 302);
  assert.match((await a.page(casePath + '?tab=history')).text, /Complaint details corrected/);
  assert.match((await a.page(casePath + '/print')).text, /Receipt/);
  const csv = await (await a.request('/reports.csv')).text(); assert.match(csv, /Corrected title/);
  const cid = casePath.split('/').pop(); assert.match((await a.page('/?q=CMP-' + cid.padStart(4, '0'))).text, /Corrected title/);
  assert.throws(() => a.db.prepare("UPDATE custody SET purpose='changed'").run(), /append-only/);
  a.db.prepare('UPDATE evidence SET content=? WHERE id=?').run(Buffer.from('changed'), eid);
  assert.equal((await a.request(`/evidence/${eid}/download`)).status, 409);
});
test('roles, CSRF, escaping, attachment validation and account management', async t => {
  const a = await setup(t); await a.login('vikram');
  assert.equal((await a.post('/complaints/1/status', { status: 'Closed', note: 'x', officer_id: '3' })).status, 403);
  assert.equal((await a.post('/officers', { name: 'X', username: 'x', password: 'Strong@123' })).status, 403);
  assert.equal((await a.post('/complaints/new', {}, false)).status, 400);
  const forgedLogout = new FormData(); forgedLogout.set('x', 'x');
  assert.equal((await a.request('/logout', { method: 'POST', body: forgedLogout })).status, 400);
  await a.post('/logout'); await a.login();
  assert.equal((await a.post('/complaints/1/status', { status: 'INVALID', note: 'x', officer_id: '2' })).status, 400);
  const evil = await a.post('/complaints/new', { name: 'Citizen', phone: '111', title: '<script>alert(1)</script>', description: 'x', category: 'Other', location: 'x', officer_id: '2' });
  assert.match((await a.page(evil.headers.get('location'))).text, /&lt;script&gt;/);
  const invalid = new FormData(); invalid.set('file', new Blob(['x']), 'x.txt');
  assert.equal((await a.request('/complaints/1/evidence', { method: 'POST', body: invalid })).status, 400);
  for (const size of [0, 10 * 1024 * 1024 + 1]) {
    const f = new FormData(); for (const [k, v] of Object.entries({ csrf: a.token(), label: 'x', kind: 'Document', location: 'x', officer_id: '2' })) f.set(k, v);
    f.set('file', new Blob([new Uint8Array(size)]), 'x.bin');
    assert.equal((await a.request('/complaints/1/evidence', { method: 'POST', body: f })).status, size ? 413 : 400);
  }
  assert.equal(a.db.prepare('SELECT COUNT(*) n FROM evidence').get().n, 0);
  assert.equal((await a.post('/officers', { name: 'New Officer', username: 'new_officer', password: 'Working@123' })).status, 302);
  assert.equal((await a.post('/officers', { name: 'Duplicate', username: 'new_officer', password: 'Working@123' })).status, 400);
  await a.post('/logout'); await a.login('new_officer', 'Working@123');
  assert.equal((await a.post('/account', { current: 'Working@123', password: 'Changed@123', confirm: 'Changed@123' })).status, 302);
  await a.post('/logout'); await a.login('new_officer', 'Changed@123');
  assert.equal((await a.page('/')).status, 200);
});
test('SQLite records survive closing and reopening the application', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kalman-persist-'));
  let a = createApp({ dataDir: dir });
  try {
    a.db.prepare('UPDATE complaints SET title=? WHERE id=1').run('Persisted record');
    a.close(); a = createApp({ dataDir: dir });
    assert.equal(a.db.prepare('SELECT title FROM complaints WHERE id=1').get().title, 'Persisted record');
  } finally { a.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('existing Python-version password hashes remain usable', async () => {
  const stored = 'scrypt:32768:8:1$XamUGyOqDaI9CB6x$e0eeb74db9c641c4e432fc888a550846c4593c9dfaa0c86cb848bcaa0b3f3d272614845609b21dcd2bef8d511f73c1756820516a7837f4ebbe5db252491d790f';
  assert.equal(await verifyPassword(stored, 'Migration@123'), true);
  assert.equal(await verifyPassword(stored, 'wrong'), false);
});
