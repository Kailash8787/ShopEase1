/**
 * E2E TESTS — Complete User Journeys
 * Layer  : End-to-End (runs after deploy to staging on main branch merges)
 * Goal   : Simulate real user workflows from start to finish.
 *          Tests the ENTIRE stack together — no mocking.
 * Runtime: ~5–10 seconds
 *
 * Each test describes a realistic user story:
 *   - New customer browses, picks a product, and places an order
 *   - Admin manages inventory lifecycle
 *   - System handles concurrent users correctly
 *   - Error paths are handled gracefully without corrupting state
 */
'use strict';
// test message

const { createApp } = require('../../app/index');
const client = require('../helpers/client');

let app, api;

beforeAll(() => {
  app = createApp();
  api = client(app);
});

afterAll(() => api.close());

beforeEach(async () => {
  await api.post('/test/reset');
});

// ═══════════════════════════════════════════════════════════════════════════
// JOURNEY 1: New customer shops
// ═══════════════════════════════════════════════════════════════════════════
describe('E2E Journey 1: Customer browses store and places an order', () => {
  test('complete browse → select → order → confirm flow', async () => {
    // ── Step 1: Customer opens the store ──────────────────────────────────
    const catalog = await api.get('/products');
    expect(catalog.status).toBe(200);
    expect(catalog.body.data.length).toBeGreaterThan(0);

    // ── Step 2: Customer filters by electronics ───────────────────────────
    const electronics = await api.get('/products?category=electronics');
    expect(electronics.status).toBe(200);
    const mouse = electronics.body.data.find(p => p.name === 'Mouse');
    expect(mouse).toBeDefined();
    expect(mouse.price).toBe(29.99);

    // ── Step 3: Customer views product detail ─────────────────────────────
    const detail = await api.get(`/products/${mouse.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.stock).toBeGreaterThan(0);

    // ── Step 4: Customer places order ─────────────────────────────────────
    const order = await api.post('/orders', {
      productId: mouse.id,
      quantity: 3,
      userId: 'customer-journey-1',
    });
    expect(order.status).toBe(201);
    expect(order.body.data.status).toBe('confirmed');
    expect(order.body.data.total).toBe(89.97); // 3 × 29.99

    // ── Step 5: Customer checks their order history ───────────────────────
    const history = await api.get('/orders/customer-journey-1');
    expect(history.status).toBe(200);
    expect(history.body.count).toBe(1);
    expect(history.body.data[0].productId).toBe(mouse.id);
  });
});
//newusertest
// ═══════════════════════════════════════════════════════════════════════════
// JOURNEY 2: Admin manages product inventory
// ═══════════════════════════════════════════════════════════════════════════
describe('E2E Journey 2: Admin manages product catalog', () => {
  test('create → update price → restock → discontinue', async () => {
    // ── Step 1: Admin creates a new product ───────────────────────────────
    const created = await api.post('/products', {
      name: 'Standing Desk', price: 599.99, stock: 15, category: 'furniture',
    });
    expect(created.status).toBe(201);
    const productId = created.body.data.id;

    // ── Step 2: Product appears in the furniture catalog ──────────────────
    const catalog = await api.get('/products?category=furniture');
    const found = catalog.body.data.find(p => p.id === productId);
    expect(found).toBeDefined();

    // ── Step 3: Admin applies a sale price ────────────────────────────────
    const discounted = await api.put(`/products/${productId}`, { price: 449.99 });
    expect(discounted.status).toBe(200);
    expect(discounted.body.data.price).toBe(449.99);
    expect(discounted.body.data.name).toBe('Standing Desk'); // name unchanged

    // ── Step 4: Admin restocks ────────────────────────────────────────────
    const restocked = await api.put(`/products/${productId}`, { stock: 100 });
    expect(restocked.status).toBe(200);
    expect(restocked.body.data.stock).toBe(100);

    // ── Step 5: Admin discontinues product ────────────────────────────────
    const deleted = await api.delete(`/products/${productId}`);
    expect(deleted.status).toBe(200);

    // ── Step 6: Product no longer in catalog ──────────────────────────────
    const afterDelete = await api.get(`/products/${productId}`);
    expect(afterDelete.status).toBe(404);

    const catalogAfter = await api.get('/products?category=furniture');
    expect(catalogAfter.body.data.find(p => p.id === productId)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// JOURNEY 3: Multiple customers, isolated orders
// ═══════════════════════════════════════════════════════════════════════════
describe('E2E Journey 3: Multiple concurrent customers', () => {
  test('separate customers have independent order histories', async () => {
    // Three customers shop at the same time
    await Promise.all([
      api.post('/orders', { productId: 1, quantity: 1, userId: 'alice' }),
      api.post('/orders', { productId: 2, quantity: 2, userId: 'bob' }),
      api.post('/orders', { productId: 3, quantity: 1, userId: 'carol' }),
    ]);

    const [alice, bob, carol] = await Promise.all([
      api.get('/orders/alice'),
      api.get('/orders/bob'),
      api.get('/orders/carol'),
    ]);

    expect(alice.body.count).toBe(1);
    expect(bob.body.count).toBe(1);
    expect(carol.body.count).toBe(1);
    expect(alice.body.data[0].productId).toBe(1);
    expect(bob.body.data[0].productId).toBe(2);
    expect(carol.body.data[0].productId).toBe(3);
  });

  test('stock is consistently reduced across multiple orders', async () => {
    // Mouse has stock 200 — order 3 separate times
    await api.post('/orders', { productId: 2, quantity: 10, userId: 'buyer-1' });
    await api.post('/orders', { productId: 2, quantity: 5,  userId: 'buyer-2' });
    await api.post('/orders', { productId: 2, quantity: 20, userId: 'buyer-3' });

    const product = await api.get('/products/2');
    expect(product.body.data.stock).toBe(165); // 200 - 10 - 5 - 20
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// JOURNEY 4: Error resilience — bad requests don't corrupt state
// ═══════════════════════════════════════════════════════════════════════════
describe('E2E Journey 4: System stays consistent after failures', () => {
  test('failed product creation does not change product count', async () => {
    const before = await api.get('/products');
    await api.post('/products', { name: '', price: -1 }); // invalid
    const after = await api.get('/products');
    expect(after.body.count).toBe(before.body.count);
  });

  test('failed order does not change stock', async () => {
    const before = await api.get('/products/1');
    await api.post('/orders', { productId: 1, quantity: 9999, userId: 'u1' }); // over stock
    const after = await api.get('/products/1');
    expect(after.body.data.stock).toBe(before.body.data.stock);
  });

  test('system health is ok after multiple errors', async () => {
    // Fire several bad requests
    await Promise.all([
      api.get('/products/99999'),
      api.post('/products', { name: '' }),
      api.post('/orders', { productId: 99999, quantity: 1, userId: 'x' }),
      api.delete('/products/99999'),
    ]);

    const health = await api.get('/health');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');

    const products = await api.get('/products');
    expect(products.body.count).toBe(3); // seed data intact
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// JOURNEY 5: Pre-deploy smoke test (must pass before releasing to production)
// ═══════════════════════════════════════════════════════════════════════════
describe('E2E Journey 5: Pre-deploy smoke test', () => {
  const endpoints = [
    { label: 'GET /health',         method: 'get',    path: '/health',            expected: 200 },
    { label: 'GET /products',       method: 'get',    path: '/products',           expected: 200 },
    { label: 'GET /products/1',     method: 'get',    path: '/products/1',         expected: 200 },
    { label: 'GET /orders/smoke',   method: 'get',    path: '/orders/smoke',       expected: 200 },
  ];

  endpoints.forEach(({ label, method, path, expected }) => {
    test(`${label} returns ${expected}`, async () => {
      const res = await api[method](path);
      expect(res.status).toBe(expected);
    });
  });

  test('can complete a full transaction in under 500ms', async () => {
    const start = Date.now();

    await api.post('/products', { name: 'Speed Test', price: 1.00, stock: 10, category: 'test' });
    const list = await api.get('/products?category=test');
    const id = list.body.data[0].id;
    await api.post('/orders', { productId: id, quantity: 1, userId: 'smoke-user' });
    await api.get(`/orders/smoke-user`);

    const duration = Date.now() - start;
    expect(duration).toBeLessThan(500);
  });
});
