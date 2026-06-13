/**
 * INTEGRATION TESTS — Orders + Product Stock Interaction
 * Layer  : Integration (runs on Pull Requests and merges to main)
 * Goal   : Test that placing an order correctly modifies product stock
 *          and that multiple components work together correctly.
 * Runtime: ~3–5 seconds
 */
 //this is a test comment for practice
'use strict';
//this is a test comment to trigger the pipeline
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
// POST /orders — Order creation
// ═══════════════════════════════════════════════════════════════════════════
describe('POST /orders — create order', () => {
  test('creates valid order and returns 201', async () => {
    const res = await api.post('/orders', { productId: 1, quantity: 2, userId: 'user-001' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('confirmed');
    expect(res.body.data.total).toBe(1999.98);   // 2 × 999.99
    expect(res.body.data.userId).toBe('user-001');
  });

  test('order deducts stock from product', async () => {
    const before = await api.get('/products/2');
    expect(before.body.data.stock).toBe(200);

    await api.post('/orders', { productId: 2, quantity: 5, userId: 'user-002' });

    const after = await api.get('/products/2');
    expect(after.body.data.stock).toBe(195);
  });

  test('rejects order when stock is insufficient', async () => {
    // Desk Chair has stock 30
    const res = await api.post('/orders', { productId: 3, quantity: 999, userId: 'user-001' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/stock/i);
  });

  test('stock NOT reduced after failed order', async () => {
    const before = await api.get('/products/3');
    await api.post('/orders', { productId: 3, quantity: 9999, userId: 'user-001' });
    const after = await api.get('/products/3');
    expect(after.body.data.stock).toBe(before.body.data.stock);
  });

  test('rejects order for non-existent product', async () => {
    const res = await api.post('/orders', { productId: 9999, quantity: 1, userId: 'user-001' });
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/not found/i);
  });

  test('rejects order with missing userId', async () => {
    const res = await api.post('/orders', { productId: 1, quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/userId/i);
  });

  test('rejects order with zero quantity', async () => {
    const res = await api.post('/orders', { productId: 1, quantity: 0, userId: 'user-001' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/quantity/i);
  });

  test('rejects order with fractional quantity', async () => {
    const res = await api.post('/orders', { productId: 1, quantity: 1.5, userId: 'user-001' });
    expect(res.status).toBe(400);
  });

  test('order total is correctly calculated', async () => {
    const res = await api.post('/orders', { productId: 2, quantity: 3, userId: 'user-003' });
    // Mouse: 29.99 × 3 = 89.97
    expect(res.body.data.total).toBe(89.97);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /orders/:userId
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /orders/:userId — retrieve user orders', () => {
  test('returns empty list for user with no orders', async () => {
    const res = await api.get('/orders/unknown-user');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.count).toBe(0);
  });

  test('returns orders for correct user only', async () => {
    await api.post('/orders', { productId: 1, quantity: 1, userId: 'alice' });
    await api.post('/orders', { productId: 2, quantity: 2, userId: 'bob' });
    await api.post('/orders', { productId: 3, quantity: 1, userId: 'alice' });

    const res = await api.get('/orders/alice');
    expect(res.body.count).toBe(2);
    res.body.data.forEach(o => expect(o.userId).toBe('alice'));
  });

  test('order list grows with each purchase', async () => {
    await api.post('/orders', { productId: 1, quantity: 1, userId: 'user-x' });
    const first = await api.get('/orders/user-x');
    expect(first.body.count).toBe(1);

    await api.post('/orders', { productId: 2, quantity: 1, userId: 'user-x' });
    const second = await api.get('/orders/user-x');
    expect(second.body.count).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /orders/detail/:id
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /orders/detail/:id — order detail', () => {
  test('retrieves specific order by id', async () => {
    const created = await api.post('/orders', { productId: 2, quantity: 1, userId: 'user-detail' });
    const orderId = created.body.data.id;

    const res = await api.get(`/orders/detail/${orderId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(orderId);
    expect(res.body.data.productId).toBe(2);
  });

  test('returns 404 for non-existent order', async () => {
    const res = await api.get('/orders/detail/9999');
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Multi-step workflow: order-then-verify
// ═══════════════════════════════════════════════════════════════════════════
describe('Workflow: create product → place order → verify stock', () => {
  test('full product lifecycle with order', async () => {
    // 1. Admin adds a new product
    const created = await api.post('/products', {
      name: 'Webcam', price: 89.99, stock: 10, category: 'electronics',
    });
    expect(created.status).toBe(201);
    const pid = created.body.data.id;

    // 2. Customer places order for 4 units
    const order = await api.post('/orders', { productId: pid, quantity: 4, userId: 'customer-A' });
    expect(order.status).toBe(201);
    expect(order.body.data.total).toBe(359.96); // 4 × 89.99

    // 3. Stock reduced correctly
    const product = await api.get(`/products/${pid}`);
    expect(product.body.data.stock).toBe(6); // 10 - 4

    // 4. Another customer tries to order more than remaining stock
    const fail = await api.post('/orders', { productId: pid, quantity: 7, userId: 'customer-B' });
    expect(fail.status).toBe(400);
    expect(fail.body.message).toMatch(/stock/i);

    // 5. Stock unchanged after failed order
    const unchanged = await api.get(`/products/${pid}`);
    expect(unchanged.body.data.stock).toBe(6);
  });
});
