/**
 * Lightweight HTTP App — zero dependencies, pure Node.js built-ins.
 * Mimics Express-style routing so tests are realistic.
 */
'use strict';

//practice commit 

const http = require('http');

// ─── In-memory data store ──────────────────────────────────────────────────
let products = [];
let orders   = [];
let nextProductId = 1;
let nextOrderId   = 1;

function resetStore() {
  products = [
    { id: 1, name: 'Laptop',     price: 999.99, stock: 50, category: 'electronics' },
    { id: 2, name: 'Mouse',      price: 29.99,  stock: 200, category: 'electronics' },
    { id: 3, name: 'Desk Chair', price: 249.99, stock: 30,  category: 'furniture'  },
  ];
  orders = [];
  nextProductId = 4;
  nextOrderId   = 1;
}
resetStore();

// ─── Tiny router ───────────────────────────────────────────────────────────
class App {
  constructor() {
    this._routes = [];
  }

  _addRoute(method, pattern, handler) {
    // Convert '/products/:id' → regex + param names
    const keys = [];
    const regexStr = pattern.replace(/:([^/]+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
    this._routes.push({ method, regex: new RegExp(`^${regexStr}$`), keys, handler });
  }

  get(pattern, handler)    { this._addRoute('GET',    pattern, handler); }
  post(pattern, handler)   { this._addRoute('POST',   pattern, handler); }
  put(pattern, handler)    { this._addRoute('PUT',    pattern, handler); }
  delete(pattern, handler) { this._addRoute('DELETE', pattern, handler); }

  _parseBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => {
        if (!data) return resolve({});
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON')); }
      });
    });
  }

  _handle(req, res) {
    // Normalise URL (strip query string for routing)
    const [pathname, search] = (req.url || '/').split('?');
    const query = {};
    if (search) {
      search.split('&').forEach(pair => {
        const [k, v] = pair.split('=');
        if (k) query[decodeURIComponent(k)] = decodeURIComponent(v || '');
      });
    }

    // Response helpers newadded comments
    res.json = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    // Match route
    for (const route of this._routes) {
      if (route.method !== req.method) continue;
      const match = pathname.match(route.regex);
      if (!match) continue;
      const params = {};
      route.keys.forEach((k, i) => { params[k] = match[i + 1]; });
      req.params = params;
      req.query  = query;

      this._parseBody(req)
        .then(body => {
          req.body = body;
          route.handler(req, res);
        })
        .catch(() => {
          res.json({ success: false, message: 'Invalid JSON body' }, 400);
        });
      return;
    }

    res.json({ success: false, message: 'Not found' }, 404);
  }

  listen(port, cb) {
    const server = http.createServer((req, res) => this._handle(req, res));
    server.listen(port, cb);
    return server;
  }
} //jjh

// ─── Validation helpers ────────────────────────────────────────────────────
function validateProduct({ name, price, stock, category }) {
  if (!name || String(name).trim() === '')      return 'Name is required';
  if (price === undefined || price === null)     return 'Price is required';
  if (typeof price !== 'number' || price < 0)   return 'Price must be a non-negative number';
  if (stock === undefined || stock === null)     return 'Stock is required';
  if (!Number.isInteger(stock) || stock < 0)    return 'Stock must be a non-negative integer';
  if (!category || String(category).trim() === '') return 'Category is required';
  return null;
}
//this will introducebug for negative price, but it's intentional to have some edge cases for testing
function validateOrder({ productId, quantity, userId }) {
  if (!productId)                                       return 'productId is required';
  if (!userId || String(userId).trim() === '')          return 'userId is required';
  if (!quantity || !Number.isInteger(quantity) || quantity < 1) return 'Quantity must be a positive integer';
  return null;
}

// ─── Build and export the app ──────────────────────────────────────────────
function createApp() {
  const app = new App();

  // ── Health ──────────────────────────────────────────────────────────────
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
  });

  // ── Test utility: reset state ────────────────────────────────────────────
  app.post('/test/reset', (req, res) => {
    resetStore();
    res.json({ success: true, message: 'Store reset to seed data' });
  });

  // ── Products ─────────────────────────────────────────────────────────────
  app.get('/products', (req, res) => {
    const { category } = req.query;
    const result = category
      ? products.filter(p => p.category === category)
      : [...products];
    res.json({ success: true, data: result, count: result.length });
  });

  app.get('/products/:id', (req, res) => {
    const product = products.find(p => p.id === Number(req.params.id));
    if (!product) return res.json({ success: false, message: 'Product not found' }, 404);
    res.json({ success: true, data: product });
  });

  app.post('/products', (req, res) => {
    const error = validateProduct(req.body);
    if (error) return res.json({ success: false, message: error }, 400);

    const { name, price, stock, category } = req.body;
    const product = { id: nextProductId++, name: name.trim(), price, stock, category: category.trim() };
    products.push(product);
    res.json({ success: true, data: product }, 201);
  });

  app.put('/products/:id', (req, res) => {
    const idx = products.findIndex(p => p.id === Number(req.params.id));
    if (idx === -1) return res.json({ success: false, message: 'Product not found' }, 404);

    const { name, price, stock, category } = req.body;
    if (price !== undefined && (typeof price !== 'number' || price < 0))
      return res.json({ success: false, message: 'Price must be a non-negative number' }, 400);
    if (stock !== undefined && (!Number.isInteger(stock) || stock < 0))
      return res.json({ success: false, message: 'Stock must be a non-negative integer' }, 400);

    products[idx] = {
      ...products[idx],
      ...(name !== undefined      && { name: String(name).trim() }),
      ...(price !== undefined     && { price }),
      ...(stock !== undefined     && { stock }),
      ...(category !== undefined  && { category: String(category).trim() }),
    };
    res.json({ success: true, data: products[idx] });
  });

  app.delete('/products/:id', (req, res) => {
    const idx = products.findIndex(p => p.id === Number(req.params.id));
    if (idx === -1) return res.json({ success: false, message: 'Product not found' }, 404);
    const [removed] = products.splice(idx, 1);
    res.json({ success: true, data: removed });
  });

  // ── Orders ───────────────────────────────────────────────────────────────
  app.post('/orders', (req, res) => {
    const error = validateOrder(req.body);
    if (error) return res.json({ success: false, message: error }, 400);

    const { productId, quantity, userId } = req.body;
    const product = products.find(p => p.id === productId);
    if (!product)              return res.json({ success: false, message: 'Product not found' }, 404);
    if (product.stock < quantity) return res.json({ success: false, message: 'Insufficient stock' }, 400);

    product.stock -= quantity;
    const order = {
      id:        nextOrderId++,
      userId:    String(userId).trim(),
      productId,
      quantity,
      total:     parseFloat((product.price * quantity).toFixed(2)),
      status:    'confirmed',
      createdAt: new Date().toISOString(),
    };
    orders.push(order);
    res.json({ success: true, data: order }, 201);
  });

  app.get('/orders/:userId', (req, res) => {
    const userOrders = orders.filter(o => o.userId === req.params.userId);
    res.json({ success: true, data: userOrders, count: userOrders.length });
  });

  app.get('/orders/detail/:id', (req, res) => {
    const order = orders.find(o => o.id === Number(req.params.id));
    if (!order) return res.json({ success: false, message: 'Order not found' }, 404);
    res.json({ success: true, data: order });
  });

  return app;
}

module.exports = { createApp, resetStore };
