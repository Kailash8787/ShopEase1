#!/usr/bin/env node
/**
 * LOCAL TEST RUNNER — Zero npm dependencies.
 * Uses Node.js 18+ built-in  `node:test`  +  `node:assert`.
 *
 * Run:   node scripts/run-tests.js
 *        node scripts/run-tests.js unit
 *        node scripts/run-tests.js integration
 *        node scripts/run-tests.js e2e
 *
 * Exit code 0 = all tests passed  (build succeeds)
 * Exit code 1 = one or more tests failed  (build fails)
 */
'use strict';

const { test, describe, beforeEach, beforeAll, afterAll, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, resetStore } = require('../app/index');

// ─── tiny HTTP client (same as tests/helpers/client.js) ──────────────────
const http = require('http');

function client(app) {
  let server, port;
  function ensureServer() {
    if (server) return Promise.resolve();
    return new Promise(r => { server = app.listen(0, () => { port = server.address().port; r(); }); });
  }
  function request(method, path, body) {
    return ensureServer().then(() => new Promise((resolve, reject) => {
      const bodyStr = body ? JSON.stringify(body) : null;
      const req = http.request({
        hostname: '127.0.0.1', port, path, method,
        headers: { 'Content-Type': 'application/json', ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}) },
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { let b; try { b = JSON.parse(d); } catch { b = d; } resolve({ status: res.statusCode, body: b }); });
      });
      req.on('error', reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    }));
  }
  return {
    get:    p    => request('GET',    p),
    post:   (p,b)=> request('POST',  p,b),
    put:    (p,b)=> request('PUT',   p,b),
    delete: p    => request('DELETE', p),
    close: ()    => new Promise(r => server ? server.close(r) : r()),
  };
}

// ─── Which suites to run ──────────────────────────────────────────────────
const SUITE = process.argv[2] || 'all';

// ─── Colour helpers ───────────────────────────────────────────────────────
const green  = s => `\x1b[32m${s}\x1b[0m`;
const red    = s => `\x1b[31m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const bold   = s => `\x1b[1m${s}\x1b[0m`;
const cyan   = s => `\x1b[36m${s}\x1b[0m`;

// ─── Simple runner harness ────────────────────────────────────────────────
let passed = 0, failed = 0, total = 0;
const failures = [];

async function run(label, fn) {
  total++;
  try {
    await fn();
    process.stdout.write(`  ${green('✓')} ${label}\n`);
    passed++;
  } catch(e) {
    process.stdout.write(`  ${red('✗')} ${label}\n`);
    failures.push({ label, error: e.message });
    failed++;
  }
}

function section(name) {
  console.log(`\n${bold(cyan('▶ ' + name))}`);
}

// ─── UNIT TESTS ───────────────────────────────────────────────────────────
async function runUnitTests() {
  section('UNIT TESTS — Products API');

  const app = createApp();
  const api = client(app);
  const reset = () => api.post('/test/reset');

  await reset();

  await run('GET /health → 200, status ok', async () => {
    const r = await api.get('/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    assert.ok(r.body.version);
  });

  await run('GET /products → returns 3 seed products', async () => {
    await reset();
    const r = await api.get('/products');
    assert.equal(r.status, 200);
    assert.equal(r.body.count, 3);
  });

  await run('GET /products?category=electronics → 2 items', async () => {
    await reset();
    const r = await api.get('/products?category=electronics');
    assert.equal(r.status, 200);
    assert.equal(r.body.count, 2);
  });

  await run('GET /products?category=unknown → 0 items', async () => {
    const r = await api.get('/products?category=unknown');
    assert.equal(r.body.count, 0);
  });

  await run('GET /products/1 → returns Laptop', async () => {
    await reset();
    const r = await api.get('/products/1');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.name, 'Laptop');
    assert.equal(r.body.data.price, 999.99);
  });

  await run('GET /products/9999 → 404 not found', async () => {
    const r = await api.get('/products/9999');
    assert.equal(r.status, 404);
    assert.equal(r.body.success, false);
  });

  await run('POST /products → 201, creates product', async () => {
    await reset();
    const r = await api.post('/products', { name: 'Keyboard', price: 79.99, stock: 100, category: 'electronics' });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.name, 'Keyboard');
    assert.ok(r.body.data.id);
  });

  await run('POST /products → created product appears in list', async () => {
    await reset();
    await api.post('/products', { name: 'Keyboard', price: 79.99, stock: 100, category: 'electronics' });
    const list = await api.get('/products');
    assert.equal(list.body.count, 4);
  });

  await run('POST /products → rejects missing name (400)', async () => {
    const r = await api.post('/products', { price: 10, stock: 5, category: 'tools' });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /name/i);
  });

  await run('POST /products → rejects negative price (400)', async () => {
    const r = await api.post('/products', { name: 'X', price: -1, stock: 5, category: 'tools' });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /price/i);
  });

  await run('POST /products → rejects fractional stock (400)', async () => {
    const r = await api.post('/products', { name: 'X', price: 1, stock: 1.5, category: 'tools' });
    assert.equal(r.status, 400);
  });

  await run('POST /products → accepts price=0', async () => {
    const r = await api.post('/products', { name: 'Free Item', price: 0, stock: 5, category: 'promo' });
    assert.equal(r.status, 201);
  });

  await run('PUT /products/1 → updates name only', async () => {
    await reset();
    const r = await api.put('/products/1', { name: 'Gaming Laptop' });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.name, 'Gaming Laptop');
    assert.equal(r.body.data.price, 999.99); // unchanged
  });

  await run('PUT /products/9999 → 404', async () => {
    const r = await api.put('/products/9999', { name: 'Ghost' });
    assert.equal(r.status, 404);
  });

  await run('DELETE /products/1 → 200, removes from list', async () => {
    await reset();
    const del = await api.delete('/products/1');
    assert.equal(del.status, 200);
    const check = await api.get('/products/1');
    assert.equal(check.status, 404);
  });

  await run('DELETE /products/9999 → 404', async () => {
    const r = await api.delete('/products/9999');
    assert.equal(r.status, 404);
  });

  await api.close();
}

// ─── INTEGRATION TESTS ────────────────────────────────────────────────────
async function runIntegrationTests() {
  section('INTEGRATION TESTS — Orders + Stock');

  const app = createApp();
  const api = client(app);
  const reset = () => api.post('/test/reset');

  await reset();

  await run('POST /orders → 201, order confirmed', async () => {
    await reset();
    const r = await api.post('/orders', { productId: 1, quantity: 2, userId: 'u1' });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.status, 'confirmed');
    assert.equal(r.body.data.total, 1999.98);
  });

  await run('POST /orders → deducts stock from product', async () => {
    await reset();
    await api.post('/orders', { productId: 2, quantity: 5, userId: 'u2' });
    const p = await api.get('/products/2');
    assert.equal(p.body.data.stock, 195);
  });

  await run('POST /orders → rejects when quantity > stock (400)', async () => {
    await reset();
    const r = await api.post('/orders', { productId: 3, quantity: 9999, userId: 'u1' });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /stock/i);
  });

  await run('POST /orders → stock NOT reduced after failed order', async () => {
    await reset();
    const before = (await api.get('/products/3')).body.data.stock;
    await api.post('/orders', { productId: 3, quantity: 9999, userId: 'u1' });
    const after = (await api.get('/products/3')).body.data.stock;
    assert.equal(after, before);
  });

  await run('POST /orders → rejects non-existent product (404)', async () => {
    const r = await api.post('/orders', { productId: 9999, quantity: 1, userId: 'u1' });
    assert.equal(r.status, 404);
  });

  await run('POST /orders → rejects missing userId (400)', async () => {
    const r = await api.post('/orders', { productId: 1, quantity: 1 });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /userId/i);
  });

  await run('POST /orders → rejects quantity=0 (400)', async () => {
    const r = await api.post('/orders', { productId: 1, quantity: 0, userId: 'u1' });
    assert.equal(r.status, 400);
  });

  await run('POST /orders → total calculated correctly', async () => {
    await reset();
    // Mouse: 29.99 × 3 = 89.97
    const r = await api.post('/orders', { productId: 2, quantity: 3, userId: 'u1' });
    assert.equal(r.body.data.total, 89.97);
  });

  await run('GET /orders/:userId → returns only that user\'s orders', async () => {
    await reset();
    await api.post('/orders', { productId: 1, quantity: 1, userId: 'alice' });
    await api.post('/orders', { productId: 2, quantity: 1, userId: 'bob' });
    const r = await api.get('/orders/alice');
    assert.equal(r.body.count, 1);
    assert.equal(r.body.data[0].userId, 'alice');
  });

  await run('GET /orders/detail/:id → retrieves specific order', async () => {
    await reset();
    const created = await api.post('/orders', { productId: 1, quantity: 1, userId: 'detail-user' });
    const id = created.body.data.id;
    const r = await api.get(`/orders/detail/${id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.id, id);
  });

  await run('Full workflow: create product → order → verify stock', async () => {
    await reset();
    const p = await api.post('/products', { name: 'Webcam', price: 89.99, stock: 10, category: 'electronics' });
    const pid = p.body.data.id;

    const order = await api.post('/orders', { productId: pid, quantity: 4, userId: 'cust-a' });
    assert.equal(order.status, 201);
    assert.equal(order.body.data.total, 359.96);

    const updated = await api.get(`/products/${pid}`);
    assert.equal(updated.body.data.stock, 6); // 10 - 4

    const fail = await api.post('/orders', { productId: pid, quantity: 7, userId: 'cust-b' });
    assert.equal(fail.status, 400); // only 6 left
  });

  await api.close();
}

// ─── E2E TESTS ────────────────────────────────────────────────────────────
async function runE2ETests() {
  section('E2E TESTS — User Journeys');

  const app = createApp();
  const api = client(app);
  const reset = () => api.post('/test/reset');

  await reset();

  await run('Journey 1: Customer browses → filters → views → orders', async () => {
    await reset();
    const catalog = await api.get('/products');
    assert.ok(catalog.body.data.length > 0);

    const elec = await api.get('/products?category=electronics');
    const mouse = elec.body.data.find(p => p.name === 'Mouse');
    assert.ok(mouse);

    const detail = await api.get(`/products/${mouse.id}`);
    assert.ok(detail.body.data.stock > 0);

    const order = await api.post('/orders', { productId: mouse.id, quantity: 3, userId: 'journey-user' });
    assert.equal(order.status, 201);
    assert.equal(order.body.data.total, 89.97);

    const history = await api.get('/orders/journey-user');
    assert.equal(history.body.count, 1);
  });

  await run('Journey 2: Admin lifecycle – create → discount → restock → remove', async () => {
    await reset();
    const created = await api.post('/products', { name: 'Standing Desk', price: 599.99, stock: 15, category: 'furniture' });
    const pid = created.body.data.id;

    const catalog = await api.get('/products?category=furniture');
    assert.ok(catalog.body.data.find(p => p.id === pid));

    const discounted = await api.put(`/products/${pid}`, { price: 449.99 });
    assert.equal(discounted.body.data.price, 449.99);
    assert.equal(discounted.body.data.name, 'Standing Desk');

    await api.delete(`/products/${pid}`);
    const gone = await api.get(`/products/${pid}`);
    assert.equal(gone.status, 404);
  });

  await run('Journey 3: Multiple customers have isolated orders', async () => {
    await reset();
    await Promise.all([
      api.post('/orders', { productId: 1, quantity: 1, userId: 'alice' }),
      api.post('/orders', { productId: 2, quantity: 2, userId: 'bob' }),
    ]);
    const alice = await api.get('/orders/alice');
    const bob   = await api.get('/orders/bob');
    assert.equal(alice.body.count, 1);
    assert.equal(bob.body.count, 1);
    assert.equal(alice.body.data[0].productId, 1);
    assert.equal(bob.body.data[0].productId, 2);
  });

  await run('Journey 4: Failed requests do not corrupt state', async () => {
    await reset();
    await api.post('/products', { name: '', price: -1 }); // invalid
    await api.post('/orders', { productId: 1, quantity: 9999, userId: 'u' }); // over stock

    const health = await api.get('/health');
    assert.equal(health.status, 200);
    const products = await api.get('/products');
    assert.equal(products.body.count, 3);
  });

  await run('Journey 5: Smoke test – all core endpoints reachable', async () => {
    await reset();
    for (const path of ['/health', '/products', '/products/1', '/orders/smoke']) {
      const r = await api.get(path);
      assert.equal(r.status, 200, `Expected 200 from ${path}, got ${r.status}`);
    }
  });

  await run('Journey 5: Full transaction completes in < 500ms', async () => {
    await reset();
    const start = Date.now();
    const p = await api.post('/products', { name: 'Speed Item', price: 1, stock: 10, category: 'test' });
    await api.post('/orders', { productId: p.body.data.id, quantity: 1, userId: 'perf-user' });
    await api.get('/orders/perf-user');
    assert.ok(Date.now() - start < 500, 'Transaction took too long');
  });

  await api.close();
}

// ─── MAIN ─────────────────────────────────────────────────────────────────
(async () => {
  console.log(bold('\n╔══════════════════════════════════════════════╗'));
  console.log(bold(`║   QA AUTOMATION PIPELINE — TEST RUNNER       ║`));
  console.log(bold('╚══════════════════════════════════════════════╝'));

  const suiteArg = (process.argv[2] || 'all').toLowerCase();

  if (suiteArg === 'unit'        || suiteArg === 'all') await runUnitTests();
  if (suiteArg === 'integration' || suiteArg === 'all') await runIntegrationTests();
  if (suiteArg === 'e2e'         || suiteArg === 'all') await runE2ETests();

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('\n' + bold('─'.repeat(50)));
  console.log(bold('TEST SUMMARY'));
  console.log('─'.repeat(50));
  console.log(`  Total :  ${total}`);
  console.log(`  ${green('Passed')} :  ${passed}`);
  if (failed > 0) {
    console.log(`  ${red('Failed')} :  ${failed}`);
    console.log(`\n${bold(red('FAILED TESTS:'))}`);
    failures.forEach(({ label, error }) => {
      console.log(`  ${red('✗')} ${label}`);
      console.log(`    ${yellow('→')} ${error}`);
    });
  }
  console.log('─'.repeat(50));

  if (failed > 0) {
    console.log(red(bold('\n❌ BUILD FAILED — ' + failed + ' test(s) failed.\n')));
    process.exit(1);  // ← GitHub Actions reads this: non-zero = build fails
  } else {
    console.log(green(bold('\n✅ BUILD PASSED — All ' + passed + ' tests passed.\n')));
    process.exit(0);  // ← non-zero = build passes
  }
})();
