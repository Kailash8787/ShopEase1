/**
 * ⚠️  INTENTIONALLY VULNERABLE WEB APP — SECURITY TESTING PRACTICE ONLY
 * ⚠️  DO NOT USE IN PRODUCTION
 *
 * Vulnerabilities:
 *   XSS-1  — Reflected XSS (search input reflected without sanitization)
 *   XSS-2  — Stored XSS (reviews stored and rendered as raw HTML)
 *   XSS-3  — DOM-based XSS (URL hash injected via innerHTML)
 *   BAC-1  — Broken Access Control: IDOR (any user views any order by ID)
 *   BAC-2  — Broken Access Control: Admin panel accessible with weak token
 *   BAC-3  — Broken Access Control: User can escalate role via profile update
 *   CF-1   — Cryptographic Failure: Plaintext passwords stored and returned
 *   CF-2   — Cryptographic Failure: Sensitive data in /health endpoint
 *   CF-3   — Cryptographic Failure: Weak token (base64 of username only)
 *   INJ-1  — Injection: Search parameter passed unsanitized (SQLi-style)
 *   INJ-2  — Injection: Login reflects unsanitized input in error message
 */

'use strict';

const http = require('http');
const url  = require('url');

const PORT = 3001;

const ADMIN_SECRET = 'shopAdmin@99';

const DB_CONFIG = {
  host: 'localhost', port: 5432,
  database: 'shopdb', username: 'shop_admin',
  password: 'Sh0pS3cr3t!Pass',
};

let users = [], products = [], orders = [], reviews = [];
let nextUserId = 1, nextOrderId = 1, nextReviewId = 1;

function resetStore() {
  users = [
    { id: 1, username: 'alice',  password: 'alice123',     email: 'alice@shop.com',  role: 'user',  balance: 500 },
    { id: 2, username: 'bob',    password: 'bob12345',     email: 'bob@shop.com',    role: 'user',  balance: 200 },
    { id: 3, username: 'carol',  password: 'carol9999',    email: 'carol@shop.com',  role: 'user',  balance: 750 },
    { id: 4, username: 'admin',  password: 'shopAdmin@99', email: 'admin@shop.com',  role: 'admin', balance: 0   },
  ];
  products = [
    { id: 1, name: 'Wireless Headphones', price: 59.99, category: 'Electronics', stock: 40, description: 'Premium sound quality with noise cancellation.' },
    { id: 2, name: 'Running Shoes',       price: 89.99, category: 'Footwear',    stock: 25, description: 'Lightweight and breathable for everyday runs.' },
    { id: 3, name: 'Coffee Maker',        price: 39.99, category: 'Kitchen',     stock: 60, description: 'Brews 12 cups with programmable timer.' },
    { id: 4, name: 'Yoga Mat',            price: 24.99, category: 'Sports',      stock: 80, description: 'Non-slip surface, 6mm thick cushioning.' },
    { id: 5, name: 'Desk Lamp',           price: 19.99, category: 'Home',        stock: 55, description: 'LED lamp with adjustable brightness.' },
    { id: 6, name: 'Backpack',            price: 49.99, category: 'Bags',        stock: 35, description: '30L waterproof travel backpack.' },
  ];
  orders = [
    { id: 1, userId: 1, productId: 1, quantity: 1, total: 59.99, status: 'delivered', date: '2026-03-10' },
    { id: 2, userId: 2, productId: 3, quantity: 2, total: 79.98, status: 'shipped',   date: '2026-03-14' },
    { id: 3, userId: 3, productId: 2, quantity: 1, total: 89.99, status: 'pending',   date: '2026-03-16' },
  ];
  reviews = [
    { id: 1, productId: 1, author: 'Alice', text: 'Absolutely love these headphones!', rating: 5, date: '2026-03-12' },
    { id: 2, productId: 1, author: 'Bob',   text: 'Good value for the price.',         rating: 4, date: '2026-03-13' },
  ];
  nextUserId = 5; nextOrderId = 4; nextReviewId = 3;
}
resetStore();

const sessions = {};

function parseBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      const out = {};
      if (!data) return resolve(out);
      if ((req.headers['content-type'] || '').includes('application/json')) {
        try { return resolve(JSON.parse(data)); } catch { return resolve(out); }
      }
      data.split('&').forEach(pair => {
        const [k, v] = pair.split('=');
        if (k) out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent((v || '').replace(/\+/g, ' '));
      });
      resolve(out);
    });
  });
}

function parseCookies(req) {
  const out = {};
  (req.headers['cookie'] || '').split(';').forEach(p => {
    const [k, v] = p.trim().split('=');
    if (k) out[k.trim()] = (v || '').trim();
  });
  return out;
}

function generateToken(username) {
  return Buffer.from(username).toString('base64');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function stars(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }

function categoryEmoji(cat) {
  const map = { Electronics: '🎧', Footwear: '👟', Kitchen: '☕', Sports: '🏋️', Home: '🪔', Bags: '🎒' };
  return map[cat] || '📦';
}

const STYLE = `
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Serif+Display&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #f7f6f3; --surface: #ffffff; --surface2: #f0ede8; --border: #e2ddd8;
  --text: #1a1815; --muted: #7a756e; --accent: #2d6a4f; --accent-light: #e8f4ee;
  --accent2: #c17b2a; --danger: #c0392b; --warn-bg: #fff8e7; --warn-border: #f0c040;
  --shadow: 0 1px 4px rgba(0,0,0,0.08); --shadow-md: 0 4px 16px rgba(0,0,0,0.1);
}
body { background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 15px; line-height: 1.6; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 2rem; display: flex; align-items: center; justify-content: space-between; height: 60px; position: sticky; top: 0; z-index: 100; box-shadow: var(--shadow); }
.logo { font-family: 'DM Serif Display', serif; font-size: 1.5rem; color: var(--accent); letter-spacing: -0.5px; }
.logo span { color: var(--accent2); }
nav { display: flex; align-items: center; gap: 1.5rem; }
nav a { color: var(--muted); font-size: 0.9rem; font-weight: 500; transition: color 0.2s; }
nav a:hover { color: var(--text); text-decoration: none; }
.nav-user { display: flex; align-items: center; gap: 0.5rem; background: var(--accent-light); border: 1px solid #b7d9c5; border-radius: 20px; padding: 4px 12px; font-size: 0.85rem; color: var(--accent); font-weight: 600; }
.warn-banner { background: var(--warn-bg); border-bottom: 1px solid var(--warn-border); padding: 6px 2rem; font-size: 0.78rem; color: #7a5c00; text-align: center; }
.container { max-width: 1080px; margin: 0 auto; padding: 2rem 1.5rem; }
.page-title { font-family: 'DM Serif Display', serif; font-size: 2rem; margin-bottom: 0.25rem; }
.page-sub { color: var(--muted); font-size: 0.9rem; margin-bottom: 2rem; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
@media (max-width: 768px) { .grid-3 { grid-template-columns: 1fr 1fr; } .grid-2 { grid-template-columns: 1fr; } }
@media (max-width: 480px) { .grid-3 { grid-template-columns: 1fr; } }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1.25rem; box-shadow: var(--shadow); }
.product-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; box-shadow: var(--shadow); transition: box-shadow 0.2s, transform 0.2s; }
.product-card:hover { box-shadow: var(--shadow-md); transform: translateY(-2px); }
.product-img { height: 160px; background: linear-gradient(135deg, var(--surface2), #e8e4dd); display: flex; align-items: center; justify-content: center; font-size: 2.5rem; }
.product-body { padding: 1rem; }
.product-name { font-weight: 600; font-size: 0.95rem; margin-bottom: 0.25rem; }
.product-cat { color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.5rem; }
.product-price { font-family: 'DM Serif Display', serif; font-size: 1.2rem; color: var(--accent); }
.product-desc { color: var(--muted); font-size: 0.82rem; margin: 0.4rem 0 0.75rem; line-height: 1.5; }
label { display: block; font-size: 0.85rem; font-weight: 600; color: var(--muted); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
input, textarea, select { background: var(--bg); border: 1px solid var(--border); border-radius: 7px; color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 0.9rem; padding: 0.55rem 0.85rem; width: 100%; outline: none; transition: border-color 0.2s, box-shadow 0.2s; margin-bottom: 1rem; }
input:focus, textarea:focus, select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(45,106,79,0.12); }
textarea { resize: vertical; min-height: 90px; }
.btn { display: inline-block; background: var(--accent); border: none; border-radius: 7px; color: #fff; cursor: pointer; font-family: 'DM Sans', sans-serif; font-size: 0.9rem; font-weight: 600; padding: 0.6rem 1.4rem; transition: background 0.2s, transform 0.1s; letter-spacing: 0.2px; }
.btn:hover { background: #235c42; text-decoration: none; }
.btn:active { transform: scale(0.98); }
.btn-sm { padding: 0.35rem 0.85rem; font-size: 0.8rem; }
.btn-outline { background: transparent; border: 1px solid var(--accent); color: var(--accent); }
.btn-outline:hover { background: var(--accent-light); }
.alert { border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1rem; font-size: 0.9rem; }
.alert-success { background: #eaf7f0; border: 1px solid #a3d9b8; color: #1d6b40; }
.alert-error   { background: #fdf0ef; border: 1px solid #f0b8b5; color: #8c1c18; }
.alert-warn    { background: var(--warn-bg); border: 1px solid var(--warn-border); color: #7a5c00; }
.alert-info    { background: #eef4ff; border: 1px solid #b3c8f5; color: #1a3a8c; }
table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
th { background: var(--surface2); padding: 0.6rem 0.9rem; text-align: left; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); border-bottom: 1px solid var(--border); }
td { padding: 0.7rem 0.9rem; border-bottom: 1px solid var(--border); }
tr:last-child td { border-bottom: none; }
tr:hover td { background: var(--surface2); }
.badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 0.72rem; font-weight: 600; }
.badge-green  { background: #eaf7f0; color: #1d6b40; border: 1px solid #a3d9b8; }
.badge-blue   { background: #eef4ff; color: #1a3a8c; border: 1px solid #b3c8f5; }
.badge-orange { background: #fff4e6; color: #8c4a00; border: 1px solid #f0c87a; }
.badge-admin  { background: #fdf0ef; color: #8c1c18; border: 1px solid #f0b8b5; }
.vuln-note { font-size: 0.72rem; color: var(--muted); font-style: italic; margin-top: 0.35rem; }
.review { padding: 0.9rem 0; border-bottom: 1px solid var(--border); }
.review:last-child { border-bottom: none; }
.review-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.35rem; }
.review-author { font-weight: 600; font-size: 0.9rem; }
.review-stars  { color: var(--accent2); font-size: 0.9rem; }
.review-date   { color: var(--muted); font-size: 0.78rem; }
.search-bar { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.search-bar input { margin-bottom: 0; }
.hero { background: linear-gradient(135deg, var(--accent) 0%, #1e4d38 100%); border-radius: 14px; padding: 3rem 2rem; color: #fff; margin-bottom: 2.5rem; }
.hero h1 { font-family: 'DM Serif Display', serif; font-size: 2.4rem; margin-bottom: 0.5rem; }
.hero p { font-size: 1rem; opacity: 0.85; margin-bottom: 1.5rem; }
.sidebar-layout { display: grid; grid-template-columns: 220px 1fr; gap: 2rem; }
@media (max-width: 768px) { .sidebar-layout { grid-template-columns: 1fr; } }
.sidebar { display: flex; flex-direction: column; gap: 0.5rem; }
.sidebar-link { display: block; padding: 0.6rem 0.9rem; border-radius: 7px; color: var(--text); font-size: 0.9rem; font-weight: 500; transition: background 0.15s; }
.sidebar-link:hover { background: var(--surface2); text-decoration: none; }
.sidebar-link.active { background: var(--accent-light); color: var(--accent); font-weight: 600; }
.section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.25rem; }
.section-title { font-family: 'DM Serif Display', serif; font-size: 1.3rem; }
code { background: rgba(0,0,0,0.07); padding: 1px 5px; border-radius: 4px; font-size: 0.82rem; font-family: monospace; }
footer { background: var(--surface); border-top: 1px solid var(--border); padding: 1.5rem 2rem; text-align: center; color: var(--muted); font-size: 0.8rem; margin-top: 4rem; }
</style>
`;

function layout(title, body, currentUser) {
  const userNav = currentUser
    ? `<div class="nav-user">👤 ${escapeHtml(currentUser.username)}
         <span class="badge ${currentUser.role === 'admin' ? 'badge-admin' : 'badge-green'}">${currentUser.role}</span>
       </div>
       <a href="/account/orders">My Orders</a>
       <a href="/account/profile">Profile</a>
       ${currentUser.role === 'admin' ? '<a href="/admin">Admin</a>' : ''}
       <a href="/logout">Logout</a>`
    : `<a href="/login">Login</a><a href="/register" class="btn btn-sm">Register</a>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — ShopEase</title>
  ${STYLE}
</head>
<body>
  <header>
    <a href="/" class="logo">Shop<span>Ease</span></a>
    <nav>
      <a href="/products">Products</a>
      <a href="/search">Search</a>
      ${userNav}
    </nav>
  </header>
  <div class="warn-banner">⚠️ Intentionally vulnerable app — for security testing practice only. Do not use in production.</div>
  <div class="container">${body}</div>
  <footer>© 2026 ShopEase · Node.js ${process.version} · Security Testing Practice App</footer>
</body>
</html>`;
}

function homePage(user) {
  const featuredHtml = products.slice(0, 3).map(p => `
    <div class="product-card">
      <div class="product-img">${categoryEmoji(p.category)}</div>
      <div class="product-body">
        <div class="product-cat">${escapeHtml(p.category)}</div>
        <div class="product-name">${escapeHtml(p.name)}</div>
        <div class="product-desc">${escapeHtml(p.description)}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:0.5rem">
          <span class="product-price">$${p.price.toFixed(2)}</span>
          <a href="/products/${p.id}" class="btn btn-sm">View</a>
        </div>
      </div>
    </div>`).join('');

  return layout('Home', `
    <div class="hero">
      <h1>Welcome to ShopEase</h1>
      <p>Quality products delivered to your door. Shop from our curated collection.</p>
      <a href="/products" class="btn" style="background:#fff;color:var(--accent)">Browse All Products →</a>
    </div>
    <div class="section-header">
      <span class="section-title">Featured Products</span>
      <a href="/products" class="btn btn-outline btn-sm">View All</a>
    </div>
    <div class="grid-3">${featuredHtml}</div>
    <div class="alert alert-warn" style="margin-top:2rem">
      <strong>🔬 Security Tester Cheatsheet:</strong><br>
      <span class="vuln-note">XSS-1 Reflected: <code>/products/&lt;script&gt;alert(1)&lt;/script&gt;</code></span><br>
      <span class="vuln-note">XSS-2 Stored: Post a review with <code>&lt;img src=x onerror=alert('XSS')&gt;</code></span><br>
      <span class="vuln-note">XSS-3 DOM: <code>/welcome#&lt;svg onload=alert(1)&gt;</code></span><br>
      <span class="vuln-note">BAC-1 IDOR: <code>/account/orders?userId=1</code> (login as bob, view alice's orders)</span><br>
      <span class="vuln-note">BAC-2 Weak Token: Set cookie <code>token=${Buffer.from('admin').toString('base64')}</code> to become admin</span><br>
      <span class="vuln-note">BAC-3 Priv Esc: Register with <code>role=admin</code> or edit profile role field</span><br>
      <span class="vuln-note">CF-1 Plaintext: Login as admin → visit <code>/admin</code> to see all passwords</span><br>
      <span class="vuln-note">CF-2 Data Leak: <code>/health</code> exposes DB password &amp; admin secret</span><br>
      <span class="vuln-note">INJ-1 SQLi-style: <code>/search?q=' OR '1'='1</code></span><br>
      <span class="vuln-note">INJ-2 Login: Enter <code>&lt;b&gt;hacker&lt;/b&gt;</code> as username to inject HTML into error</span>
    </div>
  `, user);
}

function productsPage(user, categoryFilter) {
  const filtered = categoryFilter
    ? products.filter(p => p.category.toLowerCase() === categoryFilter.toLowerCase())
    : products;
  const categories = [...new Set(products.map(p => p.category))];
  const catLinks = categories.map(c =>
    `<a href="/products?category=${encodeURIComponent(c)}" class="sidebar-link ${categoryFilter === c ? 'active' : ''}">${c}</a>`
  ).join('');
  const cardsHtml = filtered.map(p => `
    <div class="product-card">
      <div class="product-img">${categoryEmoji(p.category)}</div>
      <div class="product-body">
        <div class="product-cat">${escapeHtml(p.category)}</div>
        <div class="product-name">${escapeHtml(p.name)}</div>
        <div class="product-desc">${escapeHtml(p.description)}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:0.5rem">
          <span class="product-price">$${p.price.toFixed(2)}</span>
          <a href="/products/${p.id}" class="btn btn-sm">View</a>
        </div>
      </div>
    </div>`).join('');
  return layout('Products', `
    <div class="sidebar-layout">
      <div class="sidebar">
        <div style="font-weight:600;font-size:0.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;padding:0 0.9rem;margin-bottom:0.25rem">Categories</div>
        <a href="/products" class="sidebar-link ${!categoryFilter ? 'active' : ''}">All Products</a>
        ${catLinks}
      </div>
      <div>
        <div class="section-header">
          <span class="section-title">${categoryFilter || 'All Products'} <span style="color:var(--muted);font-size:1rem">(${filtered.length})</span></span>
        </div>
        <div class="grid-3">${cardsHtml || '<p style="color:var(--muted)">No products found.</p>'}</div>
      </div>
    </div>`, user);
}

function productDetailPage(user, productId, msg, err) {
  const product = products.find(p => p.id === Number(productId));
  if (!product) {
    // 🔴 XSS-1: Raw productId injected into HTML
    return layout('Not Found', `
      <div class="alert alert-error">Product not found: <strong>${productId}</strong></div>
      <p class="vuln-note">⚠️ XSS-1: Product ID injected without sanitization.</p>
      <a href="/products" class="btn btn-outline" style="margin-top:1rem">← Back to Products</a>
    `, user);
  }
  const productReviews = reviews.filter(r => r.productId === product.id);
  const reviewsHtml = productReviews.length
    ? productReviews.map(r => `
        <div class="review">
          <div class="review-header">
            <span class="review-author">${escapeHtml(r.author)}</span>
            <span class="review-stars">${stars(r.rating)}</span>
            <span class="review-date">${r.date}</span>
          </div>
          <!-- 🔴 XSS-2: raw HTML stored XSS -->
          <div>${r.text}</div>
        </div>`).join('')
    : '<p style="color:var(--muted);padding:1rem 0">No reviews yet.</p>';

  const msgHtml = msg ? `<div class="alert alert-success">${escapeHtml(msg)}</div>` : '';
  const errHtml = err ? `<div class="alert alert-error">${escapeHtml(err)}</div>` : '';
  const reviewForm = user
    ? `<div class="card" style="margin-top:1.5rem">
        <div class="section-title" style="font-size:1.1rem;margin-bottom:1rem">Write a Review</div>
        ${errHtml}
        <form method="POST" action="/products/${product.id}/review">
          <label>Rating</label>
          <select name="rating">
            <option value="5">★★★★★ Excellent</option>
            <option value="4">★★★★☆ Good</option>
            <option value="3">★★★☆☆ Average</option>
            <option value="2">★★☆☆☆ Poor</option>
            <option value="1">★☆☆☆☆ Terrible</option>
          </select>
          <label>Your Review</label>
          <textarea name="text" placeholder="Share your experience..."></textarea>
          <p class="vuln-note">💡 XSS-2 (Stored): Try <code>&lt;img src=x onerror=alert('StoredXSS')&gt;</code></p>
          <button type="submit" class="btn">Submit Review</button>
        </form>
      </div>`
    : `<div class="alert alert-info" style="margin-top:1rem"><a href="/login">Login</a> to write a review.</div>`;

  return layout(product.name, `
    <div style="margin-bottom:1rem"><a href="/products" style="color:var(--muted);font-size:0.85rem">← Back to Products</a></div>
    ${msgHtml}
    <div class="grid-2" style="align-items:start">
      <div style="background:var(--surface2);border-radius:12px;height:280px;display:flex;align-items:center;justify-content:center;font-size:5rem">
        ${categoryEmoji(product.category)}
      </div>
      <div>
        <div style="font-size:0.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:0.5rem">${escapeHtml(product.category)}</div>
        <h1 style="font-family:'DM Serif Display',serif;font-size:1.8rem;margin-bottom:0.75rem">${escapeHtml(product.name)}</h1>
        <p style="color:var(--muted);margin-bottom:1.25rem">${escapeHtml(product.description)}</p>
        <div style="font-family:'DM Serif Display',serif;font-size:2rem;color:var(--accent);margin-bottom:1rem">$${product.price.toFixed(2)}</div>
        <div style="color:var(--muted);font-size:0.85rem;margin-bottom:1.5rem">Stock: ${product.stock} units</div>
        ${user
          ? `<form method="POST" action="/orders">
               <input type="hidden" name="productId" value="${product.id}">
               <div style="display:flex;gap:0.75rem;align-items:center">
                 <input type="number" name="quantity" value="1" min="1" max="${product.stock}" style="width:80px;margin-bottom:0">
                 <button type="submit" class="btn">Place Order</button>
               </div>
             </form>`
          : `<div class="alert alert-info"><a href="/login">Login</a> to place an order.</div>`}
      </div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:2rem 0">
    <div class="section-title" style="margin-bottom:1rem">Customer Reviews</div>
    <div class="card">${reviewsHtml}</div>
    ${reviewForm}
  `, user);
}

function searchPage(user, query) {
  let resultsHtml = '';
  if (query !== null && query !== undefined) {
    const q = query.toLowerCase();
    const found = products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    );
    // 🔴 INJ-1: Raw query in simulated SQL
    const simQuery = `SELECT * FROM products WHERE name LIKE '%${query}%' OR category LIKE '%${query}%'`;
    resultsHtml = `
      <div class="alert alert-warn" style="font-size:0.82rem">
        <strong>INJ-1:</strong> Simulated DB query: <code>${simQuery}</code>
        <div class="vuln-note">Try: <code>' OR '1'='1</code> or <code>'; DROP TABLE products;--</code></div>
      </div>
      ${found.length > 0
        ? `<p style="color:var(--muted);margin-bottom:1rem">${found.length} result(s) for: <strong>${query}</strong></p>
           <div class="grid-3">${found.map(p => `
             <div class="product-card">
               <div class="product-img">${categoryEmoji(p.category)}</div>
               <div class="product-body">
                 <div class="product-cat">${escapeHtml(p.category)}</div>
                 <div class="product-name">${escapeHtml(p.name)}</div>
                 <div class="product-price">$${p.price.toFixed(2)}</div>
                 <a href="/products/${p.id}" class="btn btn-sm" style="margin-top:0.5rem;display:inline-block">View</a>
               </div>
             </div>`).join('')}</div>`
        : `<div class="alert alert-error">No results for: <strong>${query}</strong></div>`}`;
  }
  return layout('Search', `
    <h1 class="page-title">Search Products</h1>
    <p class="page-sub">Find products by name, category, or description.</p>
    <form method="GET" action="/search" class="search-bar">
      <input type="text" name="q" value="${query ? escapeHtml(query) : ''}" placeholder="Search products...">
      <button type="submit" class="btn">Search</button>
    </form>
    <p class="vuln-note" style="margin-bottom:1.5rem">
      💡 INJ-1: Try <code>' OR '1'='1</code> &nbsp;|&nbsp; XSS: Try <code>&lt;script&gt;alert(1)&lt;/script&gt;</code>
    </p>
    ${resultsHtml}
  `, user);
}

function loginPage(user, err) {
  // 🔴 INJ-2: err contains raw username — no escaping
  const errHtml = err ? `<div class="alert alert-error">${err}</div>` : '';
  return layout('Login', `
    <div style="max-width:420px;margin:3rem auto">
      <h1 class="page-title">Welcome back</h1>
      <p class="page-sub">Login to your ShopEase account.</p>
      <div class="card">
        ${errHtml}
        <form method="POST" action="/login">
          <label>Username</label>
          <input type="text" name="username" placeholder="Enter your username" autocomplete="username">
          <label>Password</label>
          <input type="password" name="password" placeholder="Enter your password" autocomplete="current-password">
          <button type="submit" class="btn" style="width:100%">Login</button>
        </form>
        <p style="text-align:center;margin-top:1rem;font-size:0.85rem;color:var(--muted)">No account? <a href="/register">Register</a></p>
        <hr style="border:none;border-top:1px solid var(--border);margin:1rem 0">
        <p class="vuln-note">💡 Test accounts: alice/alice123 · bob/bob12345 · admin/shopAdmin@99</p>
        <p class="vuln-note">💡 INJ-2: Enter <code>&lt;b&gt;hacker&lt;/b&gt;</code> as username to inject HTML in error</p>
        <p class="vuln-note">💡 CF-1: Passwords stored plaintext — check /admin after login</p>
      </div>
    </div>
  `, user);
}

function registerPage(user, err) {
  const errHtml = err ? `<div class="alert alert-error">${escapeHtml(err)}</div>` : '';
  return layout('Register', `
    <div style="max-width:420px;margin:3rem auto">
      <h1 class="page-title">Create Account</h1>
      <p class="page-sub">Join ShopEase today.</p>
      <div class="card">
        ${errHtml}
        <form method="POST" action="/register">
          <label>Username</label>
          <input type="text" name="username" placeholder="Choose a username">
          <label>Email</label>
          <input type="email" name="email" placeholder="your@email.com">
          <label>Password</label>
          <input type="password" name="password" placeholder="Choose a password">
          <label>Role</label>
          <select name="role">
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <p class="vuln-note">💡 BAC-3: Role field accepted from form — select Admin to escalate privileges</p>
          <button type="submit" class="btn" style="width:100%;margin-top:0.25rem">Create Account</button>
        </form>
        <p style="text-align:center;margin-top:1rem;font-size:0.85rem;color:var(--muted)">Have an account? <a href="/login">Login</a></p>
      </div>
    </div>
  `, user);
}

function myOrdersPage(user, viewingUserId, msg) {
  // 🔴 BAC-1 IDOR: userId from URL, no ownership check
  const targetId = viewingUserId ? Number(viewingUserId) : user.id;
  const targetUser = users.find(u => u.id === targetId);
  const userOrders = orders.filter(o => o.userId === targetId);
  const isOwn = targetId === user.id;
  const idorWarn = !isOwn ? `
    <div class="alert alert-error">
      ⚠️ <strong>BAC-1 (IDOR):</strong> Viewing orders for
      <strong>${targetUser ? escapeHtml(targetUser.username) : `user #${targetId}`}</strong> — not your account!
    </div>` : '';
  const rowsHtml = userOrders.map(o => {
    const prod = products.find(p => p.id === o.productId);
    return `<tr>
      <td>#${o.id}</td>
      <td>${prod ? escapeHtml(prod.name) : 'Unknown'}</td>
      <td>${o.quantity}</td>
      <td>$${o.total.toFixed(2)}</td>
      <td><span class="badge ${o.status === 'delivered' ? 'badge-green' : o.status === 'shipped' ? 'badge-blue' : 'badge-orange'}">${o.status}</span></td>
      <td><a href="/orders/${o.id}" class="btn btn-outline btn-sm">Details</a></td>
    </tr>`;
  }).join('');
  return layout('My Orders', `
    <div class="section-header"><h1 class="page-title">My Orders</h1></div>
    ${idorWarn}
    ${msg ? `<div class="alert alert-success">${escapeHtml(msg)}</div>` : ''}
    <div class="alert alert-warn" style="margin-bottom:1rem;font-size:0.85rem">
      💡 <strong>BAC-1 (IDOR):</strong> Change userId in URL:
      <code>/account/orders?userId=1</code> · <code>?userId=2</code> · <code>?userId=3</code>
    </div>
    <div class="card">
      ${rowsHtml
        ? `<table><thead><tr><th>Order</th><th>Product</th><th>Qty</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>`
        : '<p style="color:var(--muted);padding:1rem 0">No orders found.</p>'}
    </div>
  `, user);
}

function orderDetailPage(user, orderId) {
  // 🔴 BAC-1: No ownership check
  const order = orders.find(o => o.id === Number(orderId));
  if (!order) {
    return layout('Not Found', `
      <div class="alert alert-error">Order <strong>${escapeHtml(String(orderId))}</strong> not found.</div>
      <a href="/account/orders" class="btn btn-outline" style="margin-top:1rem">← My Orders</a>
    `, user);
  }
  const isOwner = order.userId === user.id;
  const prod = products.find(p => p.id === order.productId);
  const orderOwner = users.find(u => u.id === order.userId);
  return layout(`Order #${order.id}`, `
    ${!isOwner ? `<div class="alert alert-error">⚠️ <strong>BAC-1 (IDOR):</strong> Order #${order.id} belongs to <strong>${orderOwner ? escapeHtml(orderOwner.username) : 'another user'}</strong>.</div>` : ''}
    <div style="margin-bottom:1rem"><a href="/account/orders" style="color:var(--muted);font-size:0.85rem">← My Orders</a></div>
    <h1 class="page-title">Order #${order.id}</h1>
    <div style="max-width:480px;margin-top:1.5rem">
      <div class="card">
        <table>
          <tr><td><strong>Product</strong></td><td>${prod ? escapeHtml(prod.name) : 'Unknown'}</td></tr>
          <tr><td><strong>Quantity</strong></td><td>${order.quantity}</td></tr>
          <tr><td><strong>Total</strong></td><td>$${order.total.toFixed(2)}</td></tr>
          <tr><td><strong>Status</strong></td><td><span class="badge ${order.status === 'delivered' ? 'badge-green' : order.status === 'shipped' ? 'badge-blue' : 'badge-orange'}">${order.status}</span></td></tr>
          <tr><td><strong>Date</strong></td><td>${order.date}</td></tr>
          <tr><td><strong>Owner User ID</strong></td><td>${order.userId}</td></tr>
        </table>
      </div>
    </div>
  `, user);
}

function adminPage(user) {
  // 🔴 BAC-2: Bypassable via forged base64 token cookie
  if (!user || user.role !== 'admin') {
    return layout('Admin', `
      <div class="alert alert-error">⛔ Access denied. Admins only.</div>
      <div class="alert alert-warn" style="margin-top:1rem">
        <strong>💡 BAC-2 — Forge the token cookie:</strong><br>
        The <code>token</code> cookie is just <code>base64(username)</code>.<br>
        DevTools → Application → Cookies → set <code>token</code> = <code>${Buffer.from('admin').toString('base64')}</code> → reload.
      </div>
      <a href="/" class="btn btn-outline" style="margin-top:1rem">← Home</a>
    `, user);
  }
  // 🔴 CF-1: Plaintext passwords exposed
  const userRows = users.map(u => `<tr>
    <td>${u.id}</td><td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.email)}</td>
    <td style="font-family:monospace;color:var(--danger)">${escapeHtml(u.password)}</td>
    <td><span class="badge ${u.role === 'admin' ? 'badge-admin' : 'badge-green'}">${u.role}</span></td>
    <td>$${u.balance}</td>
  </tr>`).join('');
  const orderRows = orders.map(o => {
    const prod = products.find(p => p.id === o.productId);
    const ou   = users.find(u => u.id === o.userId);
    return `<tr>
      <td>#${o.id}</td><td>${ou ? escapeHtml(ou.username) : o.userId}</td>
      <td>${prod ? escapeHtml(prod.name) : 'Unknown'}</td>
      <td>$${o.total.toFixed(2)}</td>
      <td><span class="badge ${o.status === 'delivered' ? 'badge-green' : o.status === 'shipped' ? 'badge-blue' : 'badge-orange'}">${o.status}</span></td>
    </tr>`;
  }).join('');
  return layout('Admin Panel', `
    <h1 class="page-title">Admin Panel</h1>
    <p class="page-sub">Full system access — users, orders, credentials.</p>
    <div class="alert alert-error">⚠️ <strong>CF-1:</strong> Plaintext passwords visible. &nbsp;|&nbsp; <strong>BAC-2:</strong> Reachable by forging <code>token</code> cookie.</div>
    <div class="section-title" style="margin:1.5rem 0 0.75rem">All Users <span style="color:var(--danger);font-size:0.85rem">(plaintext passwords)</span></div>
    <div class="card" style="margin-bottom:1.5rem;overflow-x:auto">
      <table><thead><tr><th>ID</th><th>Username</th><th>Email</th><th style="color:var(--danger)">Password ⚠️</th><th>Role</th><th>Balance</th></tr></thead><tbody>${userRows}</tbody></table>
    </div>
    <div class="section-title" style="margin-bottom:0.75rem">All Orders</div>
    <div class="card" style="overflow-x:auto">
      <table><thead><tr><th>ID</th><th>User</th><th>Product</th><th>Total</th><th>Status</th></tr></thead><tbody>${orderRows}</tbody></table>
    </div>
  `, user);
}

function profilePage(user, msg) {
  return layout('My Profile', `
    <div style="max-width:500px">
      <h1 class="page-title">My Profile</h1>
      <p class="page-sub">Manage your account details.</p>
      ${msg ? `<div class="alert alert-success">${escapeHtml(msg)}</div>` : ''}
      <div class="card">
        <form method="POST" action="/account/profile">
          <label>Username</label>
          <input type="text" name="username" value="${escapeHtml(user.username)}">
          <label>Email</label>
          <input type="email" name="email" value="${escapeHtml(user.email)}">
          <label>New Password</label>
          <input type="password" name="password" placeholder="Leave blank to keep current">
          <label>Role</label>
          <input type="text" name="role" value="${escapeHtml(user.role)}">
          <p class="vuln-note">💡 BAC-3: Change role to <code>admin</code> and save to escalate privileges</p>
          <button type="submit" class="btn">Save Changes</button>
        </form>
      </div>
      <div class="alert alert-warn" style="margin-top:1rem">
        💡 <strong>CF-2:</strong> Visit <a href="/health">/health</a> to see DB credentials and admin secret in JSON.
      </div>
    </div>
  `, user);
}

function domXssPage(user) {
  return layout('Welcome', `
    <div style="max-width:580px;margin:2rem auto">
      <h1 class="page-title">Personalised Welcome</h1>
      <div class="card">
        <p style="color:var(--muted);margin-bottom:1rem">Your name is read from the URL hash:</p>
        <div id="vuln-msg" class="alert alert-info">Add your name: <code>/welcome#YourName</code></div>
        <div id="safe-msg" class="alert alert-success" style="margin-top:0.5rem;display:none"></div>
        <hr style="border:none;border-top:1px solid var(--border);margin:1rem 0">
        <p class="vuln-note">💡 XSS-3 (DOM): Try <code>/welcome#&lt;img src=x onerror=alert('DOM-XSS')&gt;</code></p>
        <p class="vuln-note">✅ Safe version (textContent) shown in green — scripts won't execute.</p>
      </div>
    </div>
    <script>
      const hash = decodeURIComponent(window.location.hash.substring(1));
      if (hash) {
        // 🔴 XSS-3 VULNERABLE: innerHTML with URL hash
        document.getElementById('vuln-msg').innerHTML = '👋 Welcome, <strong>' + hash + '</strong>!';
        // ✅ SAFE
        const safe = document.getElementById('safe-msg');
        safe.style.display = '';
        safe.textContent = '✅ Safe: Hello, ' + hash + '!';
      }
    </script>
  `, user);
}

const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const cookies  = parseCookies(req);
  const sid = cookies['session'];
  let currentUser = sid && sessions[sid] ? users.find(u => u.id === sessions[sid]) || null : null;

  // 🔴 BAC-2: Weak forgeable token
  if (!currentUser && cookies['token']) {
    try {
      const decoded = Buffer.from(cookies['token'], 'base64').toString('utf8');
      currentUser = users.find(u => u.username === decoded) || null;
    } catch {}
  }

  function sendHtml(content, status = 200) {
    // 🔴 No CSP / security headers
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  }
  function redirect(loc) { res.writeHead(302, { Location: loc }); res.end(); }

  if (req.method === 'GET' && pathname === '/')
    return sendHtml(homePage(currentUser));
  if (req.method === 'GET' && pathname === '/products')
    return sendHtml(productsPage(currentUser, parsed.query.category || null));
  if (req.method === 'GET' && pathname.match(/^\/products\/[^/]+$/))
    return sendHtml(productDetailPage(currentUser, pathname.split('/')[2], parsed.query.msg, parsed.query.err));
  if (req.method === 'POST' && pathname.match(/^\/products\/(\d+)\/review$/)) {
    if (!currentUser) return redirect('/login');
    const productId = Number(pathname.split('/')[2]);
    const body = await parseBody(req);
    if (!(body.text || '').trim()) return redirect(`/products/${productId}?err=Review+text+required`);
    // 🔴 XSS-2: stored raw
    reviews.push({ id: nextReviewId++, productId, author: currentUser.username, text: body.text, rating: Math.min(5, Math.max(1, Number(body.rating) || 5)), date: new Date().toISOString().split('T')[0] });
    return redirect(`/products/${productId}?msg=Review+posted!`);
  }
  if (req.method === 'GET' && pathname === '/search')
    return sendHtml(searchPage(currentUser, parsed.query.q !== undefined ? parsed.query.q : null));
  if (req.method === 'GET' && pathname === '/welcome')
    return sendHtml(domXssPage(currentUser));
  if (req.method === 'GET' && pathname === '/login')
    return sendHtml(loginPage(currentUser, null));
  if (req.method === 'POST' && pathname === '/login') {
    const body = await parseBody(req);
    const { username, password } = body;
    const found = users.find(u => u.username === username);
    if (!found) return sendHtml(loginPage(null, `User not found: ${username}`)); // 🔴 INJ-2
    if (found.password !== password) return sendHtml(loginPage(null, `Incorrect password for: ${escapeHtml(username)}`)); // 🔴 CF-1
    const newSid = Math.random().toString(36).substring(2) + Date.now().toString(36);
    sessions[newSid] = found.id;
    res.writeHead(302, { 'Set-Cookie': [`session=${newSid}; Path=/`, `token=${generateToken(found.username)}; Path=/`], Location: '/' });
    return res.end();
  }
  if (req.method === 'GET' && pathname === '/register')
    return sendHtml(registerPage(currentUser, null));
  if (req.method === 'POST' && pathname === '/register') {
    const body = await parseBody(req);
    const { username, email, password, role } = body;
    if (!username || !password) return sendHtml(registerPage(null, 'Username and password required'));
    if (users.find(u => u.username === username)) return sendHtml(registerPage(null, 'Username already taken'));
    users.push({ id: nextUserId++, username, email: email || '', password, role: role || 'user', balance: 100 }); // 🔴 BAC-3
    return redirect('/login');
  }
  if (req.method === 'POST' && pathname === '/orders') {
    if (!currentUser) return redirect('/login');
    const body = await parseBody(req);
    const productId = Number(body.productId), quantity = Number(body.quantity) || 1;
    const product = products.find(p => p.id === productId);
    if (!product) return redirect('/products');
    if (product.stock < quantity) return redirect(`/products/${productId}?err=Insufficient+stock`);
    product.stock -= quantity;
    orders.push({ id: nextOrderId++, userId: currentUser.id, productId, quantity, total: parseFloat((product.price * quantity).toFixed(2)), status: 'pending', date: new Date().toISOString().split('T')[0] });
    return redirect('/account/orders?msg=Order+placed!');
  }
  if (req.method === 'GET' && pathname === '/account/orders') {
    if (!currentUser) return redirect('/login');
    return sendHtml(myOrdersPage(currentUser, parsed.query.userId, parsed.query.msg)); // 🔴 BAC-1
  }
  if (req.method === 'GET' && pathname.match(/^\/orders\/\d+$/)) {
    if (!currentUser) return redirect('/login');
    return sendHtml(orderDetailPage(currentUser, pathname.split('/')[2]));
  }
  if (req.method === 'GET' && pathname === '/account/profile') {
    if (!currentUser) return redirect('/login');
    return sendHtml(profilePage(currentUser, parsed.query.msg));
  }
  if (req.method === 'POST' && pathname === '/account/profile') {
    if (!currentUser) return redirect('/login');
    const body = await parseBody(req);
    const idx = users.findIndex(u => u.id === currentUser.id);
    if (idx !== -1) {
      if (body.username) users[idx].username = body.username;
      if (body.email)    users[idx].email    = body.email;
      if (body.password) users[idx].password = body.password;
      if (body.role)     users[idx].role     = body.role; // 🔴 BAC-3
    }
    return redirect('/account/profile?msg=Profile+updated!');
  }
  if (req.method === 'GET' && pathname === '/admin')
    return sendHtml(adminPage(currentUser));
  if (req.method === 'GET' && pathname === '/health') {
    // 🔴 CF-2: Exposes DB config and admin secret
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', version: '1.0.0', nodeVersion: process.version, environment: 'production', uptime: process.uptime(), database: DB_CONFIG, adminSecret: ADMIN_SECRET }, null, 2));
  }
  if (req.method === 'GET' && pathname === '/logout') {
    if (sid) delete sessions[sid];
    res.writeHead(302, { 'Set-Cookie': ['session=;Path=/;Max-Age=0', 'token=;Path=/;Max-Age=0'], Location: '/' });
    return res.end();
  }
  if (req.method === 'POST' && pathname === '/test/reset') {
    resetStore();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true }));
  }
  sendHtml(layout('Not Found', `
    <div class="alert alert-error">Page not found: <strong>${escapeHtml(pathname)}</strong></div>
    <a href="/" class="btn btn-outline" style="margin-top:1rem">← Home</a>
  `, currentUser), 404);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ⚠️  VULNERABLE WEB APP — FOR SECURITY TESTING ONLY');
  console.log(`  🚀 App: http://localhost:${PORT}`);
  console.log('');
  console.log('  Test accounts: alice/alice123 · bob/bob12345 · admin/shopAdmin@99');
  console.log(`  ZAP target:    http://localhost:${PORT}`);
  console.log('');
});