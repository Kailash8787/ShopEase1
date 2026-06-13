/**
 * ⚠️  INTENTIONALLY VULNERABLE WEB APP — SECURITY TESTING PRACTICE ONLY
 * ⚠️  DO NOT USE IN PRODUCTION
 *
 * Vulnerabilities (silent — UI looks like a real shop):
 *   XSS-1  — Reflected XSS   : /products/<payload>  (raw id in error page)
 *   XSS-2  — Stored XSS      : POST /products/:id/review (raw text rendered)
 *   XSS-3  — DOM XSS         : /welcome#<payload>   (innerHTML from hash)
 *   BAC-1  — IDOR            : /account/orders?userId=N
 *   BAC-2  — Weak Token      : token cookie = base64(username)
 *   BAC-3  — Privilege Esc.  : role field accepted on register / profile
 *   CF-1   — Plaintext Pwds  : /admin shows all passwords
 *   CF-2   — Data Leak       : /health exposes DB config + admin secret
 *   CF-3   — Weak Token      : base64 forgeable
 *   INJ-1  — Real SQL Inj.   : /search?q= raw string concat in SQL query
 *   INJ-2  — HTML Injection  : login error reflects raw username
 *   CART-1 — XSS via Cart    : product name rendered raw in cart page
 *   CART-2 — Mass Assignment : price manipulable via POST body
 *   ADM-1  — No CSRF         : /admin/delete-user has no CSRF token
 *   ORD-1  — IDOR Edit       : any user can edit any order by guessing ID
 *   ORD-2  — Status Tamper   : user can set order status to anything
 */

'use strict';

const http = require('http');
const url  = require('url');
const db   = require('./db');
const PORT = 3001;

// ── Sensitive config (CF-1, CF-2) ──────────────────────────────────────────
const ADMIN_SECRET = 'shopAdmin@99';
const DB_CONFIG    = { host:'localhost', port:5432, database:'shopdb', username:'shop_admin', password:'Sh0pS3cr3t!Pass' };

const sessions = {};
const carts = {}; // cart store: { userId: [{productId, name, price, quantity}] }

// ── Helpers ─────────────────────────────────────────────────────────────────
function parseBody(req){
  return new Promise(res=>{
    let d='';
    req.on('data',c=>d+=c);
    req.on('end',()=>{
      const o={};
      if(!d) return res(o);
      if((req.headers['content-type']||'').includes('application/json')){
        try{return res(JSON.parse(d));}catch{return res(o);}
      }
      d.split('&').forEach(p=>{
        const[k,v]=p.split('=');
        if(k) o[decodeURIComponent(k.replace(/\+/g,' '))]=decodeURIComponent((v||'').replace(/\+/g,' '));
      });
      res(o);
    });
  });
}

function parseCookies(req){
  const o={};
  (req.headers['cookie']||'').split(';').forEach(p=>{
    const[k,v]=p.trim().split('=');
    if(k) o[k.trim()]=(v||'').trim();
  });
  return o;
}

function esc(s){ // HTML escape — used for safe output; intentionally NOT used in vuln spots
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}

function stars(n){ return '★'.repeat(n)+'☆'.repeat(5-n); }
function tok(u){ return Buffer.from(u).toString('base64'); } // CF-3: weak token

// ── CSS ──────────────────────────────────────────────────────────────────────
const CSS=`
<style>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=Nunito:wght@300;400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --ink:#1c1917;--ink2:#57534e;--ink3:#a8a29e;
  --bg:#fafaf9;--card:#ffffff;--border:#e7e5e4;
  --green:#16a34a;--green-bg:#f0fdf4;--green-bd:#bbf7d0;
  --blue:#2563eb;--blue-bg:#eff6ff;--blue-bd:#bfdbfe;
  --red:#dc2626;--red-bg:#fef2f2;--red-bd:#fecaca;
  --amber:#d97706;--amber-bg:#fffbeb;--amber-bd:#fde68a;
  --accent:#0f766e;--accent-h:#0d9488;
  --r:10px;--shadow:0 1px 3px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.04);
  --shadow-lg:0 10px 25px rgba(0,0,0,.08),0 4px 10px rgba(0,0,0,.05);
}
body{background:var(--bg);color:var(--ink);font-family:'Nunito',sans-serif;font-size:15px;line-height:1.65;min-height:100vh}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
img{display:block}

/* ── Header ── */
header{background:#fff;border-bottom:1px solid var(--border);height:62px;display:flex;align-items:center;justify-content:space-between;padding:0 2rem;position:sticky;top:0;z-index:50;box-shadow:var(--shadow)}
.logo{font-family:'Playfair Display',serif;font-size:1.45rem;color:var(--accent);font-weight:600;letter-spacing:-.3px}
.logo em{color:var(--amber);font-style:normal}
nav{display:flex;align-items:center;gap:1.25rem}
nav a{color:var(--ink2);font-size:.875rem;font-weight:600;padding:6px 10px;border-radius:6px;transition:background .15s,color .15s}
nav a:hover{background:#f5f5f4;color:var(--ink);text-decoration:none}
.chip{display:inline-flex;align-items:center;gap:5px;background:var(--green-bg);border:1px solid var(--green-bd);border-radius:20px;padding:3px 10px;font-size:.78rem;color:var(--green);font-weight:700}
.chip.admin{background:var(--red-bg);border-color:var(--red-bd);color:var(--red)}

/* ── Layout ── */
.wrap{max-width:1100px;margin:0 auto;padding:2rem 1.5rem}
.page-head{margin-bottom:2rem}
.page-head h1{font-family:'Playfair Display',serif;font-size:2rem;font-weight:600;margin-bottom:.25rem}
.page-head p{color:var(--ink2);font-size:.9rem}

/* ── Grid ── */
.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:1.25rem}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:1.75rem;align-items:start}
.g-side{display:grid;grid-template-columns:210px 1fr;gap:2rem}
@media(max-width:800px){.g3{grid-template-columns:1fr 1fr}.g2,.g-side{grid-template-columns:1fr}}
@media(max-width:480px){.g3{grid-template-columns:1fr}}

/* ── Card ── */
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:1.5rem;box-shadow:var(--shadow)}
.pcard{background:var(--card);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;box-shadow:var(--shadow);transition:box-shadow .2s,transform .2s}
.pcard:hover{box-shadow:var(--shadow-lg);transform:translateY(-3px)}
.pcard-img{height:158px;display:flex;align-items:center;justify-content:center;font-size:3rem;background:linear-gradient(135deg,#f5f5f4,#e7e5e4)}
.pcard-body{padding:1rem 1.1rem 1.1rem}
.pcat{font-size:.72rem;text-transform:uppercase;letter-spacing:.6px;color:var(--ink3);margin-bottom:.3rem;font-weight:700}
.pname{font-weight:700;font-size:.95rem;margin-bottom:.3rem;color:var(--ink)}
.pdesc{color:var(--ink2);font-size:.8rem;line-height:1.5;margin-bottom:.75rem}
.pprice{font-family:'Playfair Display',serif;font-size:1.25rem;color:var(--accent)}

/* ── Forms ── */
.field{margin-bottom:1rem}
.field label{display:block;font-size:.8rem;font-weight:700;color:var(--ink2);margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px}
input,textarea,select{width:100%;background:#fafaf9;border:1.5px solid var(--border);border-radius:7px;color:var(--ink);font-family:'Nunito',sans-serif;font-size:.9rem;padding:.55rem .85rem;outline:none;transition:border-color .2s,box-shadow .2s}
input:focus,textarea:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(15,118,110,.1)}
textarea{resize:vertical;min-height:95px}

/* ── Buttons ── */
.btn{display:inline-block;background:var(--accent);border:none;border-radius:7px;color:#fff;cursor:pointer;font-family:'Nunito',sans-serif;font-size:.875rem;font-weight:700;padding:.55rem 1.3rem;transition:background .15s,transform .1s;letter-spacing:.1px}
.btn:hover{background:var(--accent-h);text-decoration:none;color:#fff}
.btn:active{transform:scale(.98)}
.btn-sm{padding:.3rem .8rem;font-size:.8rem;border-radius:6px}
.btn-ghost{background:transparent;border:1.5px solid var(--border);color:var(--ink2)}
.btn-ghost:hover{background:#f5f5f4;color:var(--ink)}
.btn-danger{background:var(--red)}
.btn-danger:hover{background:#b91c1c}
.btn-outline{background:transparent;border:1.5px solid var(--accent);color:var(--accent)}
.btn-outline:hover{background:var(--green-bg)}
.btn-white{background:#fff;color:var(--accent);border:none}
.btn-white:hover{background:#f0fdf4}

/* ── Alerts ── */
.alert{border-radius:8px;padding:.7rem 1rem;margin-bottom:1rem;font-size:.875rem;border:1px solid}
.alert-ok  {background:var(--green-bg);border-color:var(--green-bd);color:#15803d}
.alert-err {background:var(--red-bg);  border-color:var(--red-bd);  color:#991b1b}
.alert-info{background:var(--blue-bg); border-color:var(--blue-bd); color:#1d4ed8}

/* ── Table ── */
table{width:100%;border-collapse:collapse;font-size:.875rem}
th{background:#f5f5f4;padding:.55rem .9rem;text-align:left;font-size:.74rem;text-transform:uppercase;letter-spacing:.5px;color:var(--ink2);border-bottom:2px solid var(--border);font-weight:700}
td{padding:.65rem .9rem;border-bottom:1px solid var(--border);color:var(--ink)}
tr:last-child td{border-bottom:none}
tr:hover td{background:#fafaf9}

/* ── Badge ── */
.badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:.72rem;font-weight:700;letter-spacing:.2px}
.b-green {background:var(--green-bg);color:#15803d;border:1px solid var(--green-bd)}
.b-blue  {background:var(--blue-bg); color:#1d4ed8;border:1px solid var(--blue-bd)}
.b-amber {background:var(--amber-bg);color:#92400e;border:1px solid var(--amber-bd)}
.b-red   {background:var(--red-bg);  color:#991b1b;border:1px solid var(--red-bd)}

/* ── Sidebar nav ── */
.snav{display:flex;flex-direction:column;gap:3px}
.snav-title{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--ink3);padding:.4rem .75rem;margin-bottom:.25rem}
.snav a{display:block;padding:.5rem .75rem;border-radius:7px;color:var(--ink2);font-size:.875rem;font-weight:500;transition:background .15s,color .15s}
.snav a:hover{background:#f5f5f4;color:var(--ink);text-decoration:none}
.snav a.on{background:var(--green-bg);color:var(--green);font-weight:700}

/* ── Hero ── */
.hero{background:linear-gradient(130deg,var(--accent) 0%,#134e4a 100%);border-radius:14px;padding:3.5rem 2.5rem;color:#fff;margin-bottom:2.5rem;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;right:-60px;top:-60px;width:260px;height:260px;border-radius:50%;background:rgba(255,255,255,.05)}
.hero::after{content:'';position:absolute;left:40%;bottom:-80px;width:200px;height:200px;border-radius:50%;background:rgba(255,255,255,.04)}
.hero h1{font-family:'Playfair Display',serif;font-size:2.5rem;margin-bottom:.5rem;line-height:1.2;position:relative}
.hero p{font-size:1rem;opacity:.85;margin-bottom:1.75rem;max-width:480px;position:relative}

/* ── Review ── */
.rev{padding:.9rem 0;border-bottom:1px solid var(--border)}
.rev:last-child{border-bottom:none}
.rev-top{display:flex;align-items:center;gap:.6rem;margin-bottom:.3rem}
.rev-author{font-weight:700;font-size:.875rem}
.rev-stars{color:var(--amber);font-size:.875rem}
.rev-date{color:var(--ink3);font-size:.76rem;margin-left:auto}
.rev-text{color:var(--ink2);font-size:.875rem}

/* ── Search bar ── */
.sbar{display:flex;gap:.5rem;margin-bottom:1.5rem}
.sbar input{margin-bottom:0}

/* ── Divider ── */
hr.div{border:none;border-top:1px solid var(--border);margin:1.75rem 0}

/* ── Misc ── */
.sec-title{font-family:'Playfair Display',serif;font-size:1.25rem;font-weight:600;margin-bottom:1rem}
.row{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem}
.muted{color:var(--ink2)}
.small{font-size:.8rem}
.mono{font-family:monospace}
code{background:#f5f5f4;padding:1px 5px;border-radius:4px;font-size:.82rem;font-family:monospace;color:var(--accent)}
footer{background:#fff;border-top:1px solid var(--border);padding:1.25rem 2rem;text-align:center;color:var(--ink3);font-size:.78rem;margin-top:5rem}

/* ── Qty input ── */
.qty-row{display:flex;gap:.75rem;align-items:center;margin-top:1.5rem}
.qty-row input{width:72px;text-align:center}

/* ── Password field style ── */
.pw-exposed{font-family:monospace;color:var(--red);font-size:.875rem}
</style>`;

// ── Layout ───────────────────────────────────────────────────────────────────
function layout(title,body,u){
  const nav=u
    ?`<div class="chip ${u.role==='admin'?'admin':''}">👤 ${esc(u.username)}</div>
       <a href="/cart">🛒 Cart</a>
       <a href="/account/orders">Orders</a>
       <a href="/account/profile">Profile</a>
       ${u.role==='admin'?'<a href="/admin">Admin</a>':''}
       <a href="/logout">Sign out</a>`
    :`<a href="/login">Sign in</a><a href="/register" class="btn btn-sm">Register</a>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)} — ShopEase</title>
  ${CSS}
</head>
<body>
<header>
  <a href="/" class="logo">Shop<em>Ease</em></a>
  <nav>
    <a href="/products">Shop</a>
    <a href="/search">Search</a>
    ${nav}
  </nav>
</header>
<div class="wrap">${body}</div>
<footer>© 2026 ShopEase &nbsp;·&nbsp; All rights reserved &nbsp;·&nbsp; Node ${process.version}</footer>
</body></html>`;
}

// ── Pages ────────────────────────────────────────────────────────────────────

function pgHome(u){
  const products = db.prepare('SELECT * FROM products LIMIT 3').all();
  const cards=products.map(p=>`
    <div class="pcard">
      <div class="pcard-img">${p.emoji||'🛍️'}</div>
      <div class="pcard-body">
        <div class="pcat">${esc(p.category)}</div>
        <div class="pname">${esc(p.name)}</div>
        <div class="pdesc">${esc(p.description)}</div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span class="pprice">$${p.price.toFixed(2)}</span>
          <a href="/products/${p.id}" class="btn btn-sm">View</a>
        </div>
      </div>
    </div>`).join('');
  return layout('Home',`
    <div class="hero">
      <h1>Quality goods,<br>delivered fast.</h1>
      <p>Discover our curated collection of everyday essentials — from electronics to outdoor gear.</p>
      <a href="/products" class="btn btn-white">Browse all products →</a>
    </div>
    <div class="row"><span class="sec-title">Featured Products</span><a href="/products" class="btn btn-outline btn-sm">View all</a></div>
    <div class="g3">${cards}</div>
  `,u);
}

function pgProducts(u,cat){
  const allProducts = db.prepare('SELECT * FROM products').all();
  const cats=[...new Set(allProducts.map(p=>p.category))];
  const list=cat?allProducts.filter(p=>p.category.toLowerCase()===cat.toLowerCase()):allProducts;
  const catNav=cats.map(c=>`<a href="/products?category=${encodeURIComponent(c)}" class="${cat===c?'on':''}">${c}</a>`).join('');
  const cards=list.map(p=>`
    <div class="pcard">
      <div class="pcard-img">${p.emoji||'🛍️'}</div>
      <div class="pcard-body">
        <div class="pcat">${esc(p.category)}</div>
        <div class="pname">${esc(p.name)}</div>
        <div class="pdesc">${esc(p.description)}</div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span class="pprice">$${p.price.toFixed(2)}</span>
          <a href="/products/${p.id}" class="btn btn-sm">View</a>
        </div>
      </div>
    </div>`).join('');
  return layout('Products',`
    <div class="g-side">
      <div>
        <div class="snav">
          <div class="snav-title">Categories</div>
          <a href="/products" class="${!cat?'on':''}">All Products</a>
          ${catNav}
        </div>
      </div>
      <div>
        <div class="row">
          <span class="sec-title">${cat||'All Products'} <span class="muted small">(${list.length})</span></span>
        </div>
        <div class="g3">${cards||'<p class="muted">No products found.</p>'}</div>
      </div>
    </div>`,u);
}

function pgProductDetail(u,pid,msg,err){
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(pid));
  if(!p){
    // 🔴 XSS-1: pid injected raw — no escaping
    return layout('Not found',`
      <div class="alert alert-err">We couldn't find a product matching <strong>${pid}</strong>.</div>
      <a href="/products" class="btn btn-ghost btn-sm" style="margin-top:.5rem">← Back to shop</a>
    `,u);
  }
  const revs = db.prepare('SELECT * FROM reviews WHERE productId = ?').all(p.id);
  const revHtml=revs.length?revs.map(r=>`
    <div class="rev">
      <div class="rev-top">
        <span class="rev-author">${esc(r.author)}</span>
        <span class="rev-stars">${stars(r.rating)}</span>
        <span class="rev-date">${r.date}</span>
      </div>
      <!-- 🔴 XSS-2: r.text rendered as raw HTML (stored XSS) -->
      <div class="rev-text">${r.text}</div>
    </div>`).join('')
    :`<p class="muted" style="padding:.75rem 0">No reviews yet — be the first!</p>`;

  const form=u?`
    <div class="card" style="margin-top:1.5rem">
      <div class="sec-title" style="font-size:1rem;margin-bottom:1rem">Write a Review</div>
      ${err?`<div class="alert alert-err">${esc(err)}</div>`:''}
      <form method="POST" action="/products/${p.id}/review">
        <div class="field">
          <label>Rating</label>
          <select name="rating">
            <option value="5">★★★★★  Excellent</option>
            <option value="4">★★★★☆  Good</option>
            <option value="3">★★★☆☆  Average</option>
            <option value="2">★★☆☆☆  Below average</option>
            <option value="1">★☆☆☆☆  Poor</option>
          </select>
        </div>
        <div class="field">
          <label>Your review</label>
          <textarea name="text" placeholder="Share your experience with this product…"></textarea>
        </div>
        <button type="submit" class="btn">Post review</button>
      </form>
    </div>`:
    `<div class="alert alert-info" style="margin-top:1rem"><a href="/login">Sign in</a> to leave a review.</div>`;

  return layout(p.name,`
    <div style="margin-bottom:1rem"><a href="/products" class="small muted">← Back to shop</a></div>
    ${msg?`<div class="alert alert-ok">${esc(msg)}</div>`:''}
    <div class="g2">
      <div style="background:linear-gradient(135deg,#f5f5f4,#e7e5e4);border-radius:12px;height:300px;display:flex;align-items:center;justify-content:center;font-size:6rem">${p.emoji||'🛍️'}</div>
      <div>
        <div class="pcat" style="margin-bottom:.5rem">${esc(p.category)}</div>
        <h1 style="font-family:'Playfair Display',serif;font-size:1.9rem;font-weight:600;margin-bottom:.75rem">${esc(p.name)}</h1>
        <p class="muted" style="margin-bottom:1.25rem">${esc(p.description)}</p>
        <div style="font-family:'Playfair Display',serif;font-size:2.1rem;color:var(--accent);margin-bottom:.5rem">$${p.price.toFixed(2)}</div>
        <p class="small muted" style="margin-bottom:1.5rem">${p.stock} units in stock</p>
        ${u?`
          <form method="POST" action="/orders">
            <input type="hidden" name="productId" value="${p.id}">
            <div class="qty-row">
              <div class="field" style="margin:0"><label class="small">Qty</label><input type="number" name="quantity" value="1" min="1" max="${p.stock}" style="width:72px;text-align:center"></div>
              <button type="submit" class="btn" style="margin-top:1.3rem">Add to order</button>
            </div>
          </form>`
          :`<div class="alert alert-info"><a href="/login">Sign in</a> to place an order.</div>`}
      </div>
    </div>
    <hr class="div">
    <div class="sec-title">Customer Reviews</div>
    <div class="card">${revHtml}</div>
    ${form}`,u);
}

function pgSearch(u,q){
  let res='';
  if(q!==null&&q!==undefined){
    let found=[];
    let sqlErr='';
    try{
      // 🔴 INJ-1: Raw string concatenation — REAL SQL injection vulnerability
      // Attacker can manipulate the query with UNION, OR, --, etc.
      const stmt=`SELECT * FROM products WHERE name LIKE '%${q}%' OR category LIKE '%${q}%' OR description LIKE '%${q}%'`;
      found=db.prepare(stmt).all();
    }catch(e){
      sqlErr=e.message;
    }
    res=`
      <p class="small muted" style="margin-bottom:1rem">
        ${found.length} result${found.length!==1?'s':''} for <strong>${q}</strong>
        ${sqlErr?`<br><code style="color:var(--red)">DB Error: ${esc(sqlErr)}</code>`:''}
      </p>
      ${found.length
        ?`<div class="g3">${found.map(p=>`
            <div class="pcard">
              <div class="pcard-img">${p.emoji||'🛍️'}</div>
              <div class="pcard-body">
                <div class="pcat">${esc(p.category||'')}</div>
                <div class="pname">${esc(p.name||'')}</div>
                <div class="pprice">${p.price!=null?'$'+Number(p.price).toFixed(2):''}</div>
                <div style="display:flex;gap:.5rem;margin-top:.6rem">
                  ${p.id?`<a href="/products/${p.id}" class="btn btn-sm btn-ghost">View</a>`:''}
                  <form method="POST" action="/cart/add" style="display:inline">
                    <input type="hidden" name="productId" value="${p.id}">
                    <input type="hidden" name="name" value="${p.name}">
                    <!-- 🔴 CART-2: price from hidden field — manipulable by attacker -->
                    <input type="hidden" name="price" value="${p.price}">
                    <button class="btn btn-sm" type="submit">🛒 Add to Cart</button>
                  </form>
                </div>
              </div>
            </div>`).join('')}</div>`
        :`<div class="alert alert-info">No products matched your search. Try a different keyword.</div>`}`;
  }
  return layout('Search',`
    <div class="page-head"><h1>Search</h1><p>Find products by name, category or description.</p></div>
    <form method="GET" action="/search" class="sbar">
      <input type="text" name="q" value="${q?esc(q):''}" placeholder="e.g. headphones, running shoes…" style="max-width:480px">
      <button type="submit" class="btn">Search</button>
    </form>
    ${res}`,u);
}

function pgLogin(u,err){
  // 🔴 INJ-2: err contains raw username, not escaped
  return layout('Sign in',`
    <div style="max-width:420px;margin:3rem auto">
      <div class="page-head"><h1>Welcome back</h1><p>Sign in to your ShopEase account.</p></div>
      <div class="card">
        ${err?`<div class="alert alert-err">${err}</div>`:''}
        <form method="POST" action="/login" id="loginForm">
          <div class="field"><label>Username</label><input type="text" id="loginUsername" name="username" placeholder="Your username" autocomplete="username" required></div>
          <div class="field"><label>Password</label><input type="password" id="loginPassword" name="password" placeholder="Your password" autocomplete="current-password" required></div>
          <button type="submit" id="loginBtn" class="btn" style="width:100%;opacity:.5;cursor:not-allowed" disabled>Sign in</button>
        </form>
        <script>
          (function(){
            const u=document.getElementById('loginUsername');
            const p=document.getElementById('loginPassword');
            const btn=document.getElementById('loginBtn');
            function check(){
              const ok=u.value.trim()!==''&&p.value.trim()!=='';
              btn.disabled=!ok;
              btn.style.opacity=ok?'1':'.5';
              btn.style.cursor=ok?'pointer':'not-allowed';
            }
            u.addEventListener('input',check);
            p.addEventListener('input',check);
            check(); // run on load so button is disabled if fields are empty (e.g. after failed login)
          })();
        </script>
        <p class="small muted" style="text-align:center;margin-top:1rem">No account? <a href="/register">Register free</a></p>
      </div>
    </div>`,u);
}

function pgRegister(u,err){
  return layout('Register',`
    <div style="max-width:420px;margin:3rem auto">
      <div class="page-head"><h1>Create account</h1><p>Join ShopEase — it's free.</p></div>
      <div class="card">
        ${err?`<div class="alert alert-err">${esc(err)}</div>`:''}
        <form method="POST" action="/register">
          <div class="field"><label>Username</label><input type="text" name="username" placeholder="Choose a username"></div>
          <div class="field"><label>Email</label><input type="email" name="email" placeholder="you@example.com"></div>
          <div class="field"><label>Password</label><input type="password" name="password" placeholder="Choose a password"></div>
          <!-- 🔴 BAC-3: role field accepted from user — privilege escalation -->
          <input type="hidden" name="role" value="user">
          <button type="submit" class="btn" style="width:100%">Create account</button>
        </form>
        <p class="small muted" style="text-align:center;margin-top:1rem">Already registered? <a href="/login">Sign in</a></p>
      </div>
    </div>`,u);
}

function pgOrders(u,viewUid,msg){
  // 🔴 BAC-1 IDOR: viewUid from URL param, no ownership check
  const tid=viewUid?Number(viewUid):u.id;
  const tuser = db.prepare('SELECT * FROM users WHERE id = ?').get(tid);
  const list = db.prepare('SELECT * FROM orders WHERE userId = ?').all(tid);
  const allProducts = db.prepare('SELECT * FROM products').all();
  const rows=list.map(o=>{
    const p=allProducts.find(x=>x.id===o.productId);
    return `<tr>
      <td>#${o.id}</td>
      <td>${p?esc(p.name):'—'}</td>
      <td>${o.quantity}</td>
      <td>$${o.total.toFixed(2)}</td>
      <td><span class="badge ${o.status==='delivered'?'b-green':o.status==='shipped'?'b-blue':'b-amber'}">${o.status}</span></td>
      <td><a href="/orders/${o.id}" class="btn btn-ghost btn-sm">Details</a></td>
    </tr>`;
  }).join('');
  return layout('My Orders',`
    <div class="row page-head" style="margin-bottom:1.5rem">
      <div><h1>My Orders</h1><p>${tid!==u.id&&tuser?`Viewing orders for <strong>${esc(tuser.username)}</strong>`:'Your order history'}</p></div>
    </div>
    ${msg?`<div class="alert alert-ok">${esc(msg)}</div>`:''}
    <div class="card">
      ${rows?`<table><thead><tr><th>Order</th><th>Product</th><th>Qty</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
            :`<p class="muted" style="padding:.5rem 0">You haven't placed any orders yet.</p>`}
    </div>`,u);
}

function pgOrderDetail(u,oid){
  // 🔴 BAC-1: no ownership check
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(oid));
  if(!o) return layout('Not found',`<div class="alert alert-err">Order not found.</div><a href="/account/orders" class="btn btn-ghost btn-sm" style="margin-top:.5rem">← My orders</a>`,u);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(o.productId);
  return layout(`Order #${o.id}`,`
    <div style="margin-bottom:1rem"><a href="/account/orders" class="small muted">← My orders</a></div>
    <div class="page-head"><h1>Order #${o.id}</h1></div>
    <div style="max-width:460px">
      <div class="card">
        <table>
          <tr><td><strong>Product</strong></td><td>${p?esc(p.name):'Unknown'}</td></tr>
          <tr><td><strong>Quantity</strong></td><td>${o.quantity}</td></tr>
          <tr><td><strong>Total</strong></td><td>$${o.total.toFixed(2)}</td></tr>
          <tr><td><strong>Status</strong></td><td><span class="badge ${o.status==='delivered'?'b-green':o.status==='shipped'?'b-blue':'b-amber'}">${o.status}</span></td></tr>
          <tr><td><strong>Date</strong></td><td>${o.date}</td></tr>
          ${o.note?`<tr><td><strong>Note</strong></td>
          <!-- 🔴 XSS: note rendered raw — stored XSS via order edit -->
          <td>${o.note}</td></tr>`:''}
        </table>
        <div style="margin-top:1.25rem">
          <a href="/orders/${o.id}/edit" class="btn btn-outline btn-sm">✏️ Edit Order</a>
        </div>
      </div>
    </div>`,u);
}

function pgProfile(u,msg){
  return layout('Profile',`
    <div class="page-head"><h1>My Profile</h1><p>Manage your account information.</p></div>
    ${msg?`<div class="alert alert-ok">${esc(msg)}</div>`:''}
    <div style="max-width:500px">
      <div class="card">
        <form method="POST" action="/account/profile">
          <div class="field"><label>Username</label><input type="text" name="username" value="${esc(u.username)}"></div>
          <div class="field"><label>Email</label><input type="email" name="email" value="${esc(u.email)}"></div>
          <div class="field"><label>New password</label><input type="password" name="password" placeholder="Leave blank to keep current"></div>
          <!-- 🔴 BAC-3: role field editable — change to admin to escalate -->
          <div class="field"><label>Role</label><input type="text" name="role" value="${esc(u.role)}"></div>
          <button type="submit" class="btn">Save changes</button>
        </form>
      </div>
    </div>`,u);
}

function pgAdmin(u){
  // 🔴 BAC-2: bypassable via forged base64 token cookie
  if(!u||u.role!=='admin'){
    return layout('Admin',`
      <div class="alert alert-err" style="max-width:480px">You do not have permission to view this page.</div>
      <a href="/" class="btn btn-ghost btn-sm" style="margin-top:1rem">← Home</a>`,u);
  }
  // 🔴 CF-1: plaintext passwords exposed
  const users = db.prepare('SELECT * FROM users').all();
  const orders = db.prepare('SELECT * FROM orders').all();
  const products = db.prepare('SELECT * FROM products').all();
  const urows=users.map(x=>`<tr>
    <td>${x.id}</td><td>${esc(x.username)}</td><td>${esc(x.email)}</td>
    <td class="pw-exposed">${esc(x.password)}</td>
    <td><span class="badge ${x.role==='admin'?'b-red':'b-green'}">${x.role}</span></td>
    <td>$${x.balance}</td>
    <td>
      <!-- 🔴 ADM-1: No CSRF token — delete can be triggered by a forged request -->
      <form method="POST" action="/admin/delete-user" style="display:inline">
        <input type="hidden" name="userId" value="${x.id}">
        <button class="btn btn-sm btn-danger" type="submit" onclick="return confirm('Delete ${esc(x.username)}?')">Delete</button>
      </form>
    </td>
  </tr>`).join('');
  const orows=orders.map(o=>{
    const p=products.find(x=>x.id===o.productId);
    const ou=users.find(x=>x.id===o.userId);
    return `<tr><td>#${o.id}</td><td>${ou?esc(ou.username):o.userId}</td><td>${p?esc(p.name):'—'}</td><td>$${o.total.toFixed(2)}</td><td><span class="badge ${o.status==='delivered'?'b-green':o.status==='shipped'?'b-blue':'b-amber'}">${o.status}</span></td></tr>`;
  }).join('');
  return layout('Admin',`
    <div class="page-head"><h1>Admin Panel</h1><p>Full system overview.</p></div>
    <div class="sec-title" style="margin-bottom:.75rem">Users</div>
    <div class="card" style="margin-bottom:1.75rem;overflow-x:auto">
      <table><thead><tr><th>ID</th><th>Username</th><th>Email</th><th>Password</th><th>Role</th><th>Balance</th><th>Actions</th></tr></thead><tbody>${urows}</tbody></table>
    </div>
    <div class="sec-title" style="margin-bottom:.75rem">Orders</div>
    <div class="card" style="overflow-x:auto">
      <table><thead><tr><th>ID</th><th>User</th><th>Product</th><th>Total</th><th>Status</th></tr></thead><tbody>${orows}</tbody></table>
    </div>`,u);
}

function pgWelcome(u){
  // 🔴 XSS-3: DOM XSS via innerHTML + location.hash
  return layout('Welcome',`
    <div style="max-width:520px;margin:3rem auto">
      <div class="card">
        <div id="msg" class="alert alert-info">Loading…</div>
      </div>
    </div>
    <script>
      const h=decodeURIComponent(window.location.hash.substring(1));
      // 🔴 XSS-3: innerHTML with user-controlled hash — no sanitization
      document.getElementById('msg').innerHTML = h
        ? '👋 Welcome back, <strong>'+h+'</strong>! Good to see you.'
        : 'Add your name to the URL: <code>/welcome#YourName</code>';
    </script>`,u);
}

// ── Cart Page ─────────────────────────────────────────────────────────────────
function pgCart(u, msg, err){
  const cart = carts[u.id] || [];
  const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const rows = cart.length ? cart.map((item, idx) => `
    <tr>
      <td>
        <!-- 🔴 CART-1: item.name rendered raw — if name contains XSS payload it fires here -->
        ${item.name}
      </td>
      <td>$${Number(item.price).toFixed(2)}</td>
      <td>
        <form method="POST" action="/cart/update" style="display:inline-flex;gap:.4rem;align-items:center">
          <input type="hidden" name="idx" value="${idx}">
          <!-- 🔴 CART-2: price sent from hidden field — attacker can modify it -->
          <input type="hidden" name="price" value="${item.price}">
          <input type="number" name="quantity" value="${item.quantity}" min="1" style="width:64px;text-align:center">
          <button class="btn btn-sm btn-ghost" type="submit">Update</button>
        </form>
      </td>
      <td>$${(item.price * item.quantity).toFixed(2)}</td>
      <td>
        <form method="POST" action="/cart/remove">
          <input type="hidden" name="idx" value="${idx}">
          <button class="btn btn-sm btn-danger" type="submit">Remove</button>
        </form>
      </td>
    </tr>`).join('') : '';

  return layout('My Cart', `
    <div class="page-head"><h1>My Cart</h1><p>Review your items before placing an order.</p></div>
    ${msg ? `<div class="alert alert-ok">${esc(msg)}</div>` : ''}
    ${err ? `<div class="alert alert-err">${esc(err)}</div>` : ''}
    ${cart.length === 0
      ? `<div class="alert alert-info">Your cart is empty. <a href="/products">Browse products →</a></div>`
      : `<div class="card" style="overflow-x:auto">
          <table>
            <thead><tr><th>Product</th><th>Price</th><th>Quantity</th><th>Subtotal</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div style="margin-top:1.25rem;text-align:right">
          <div style="font-family:'Playfair Display',serif;font-size:1.5rem;margin-bottom:1rem">
            Total: <strong style="color:var(--accent)">$${total.toFixed(2)}</strong>
          </div>
          <form method="POST" action="/cart/checkout">
            <button class="btn" type="submit">Place Order →</button>
          </form>
        </div>`
    }`, u);
}

// ── Edit Order Page ───────────────────────────────────────────────────────────
function pgEditOrder(u, oid, msg, err){
  // 🔴 ORD-1: no ownership check — any logged-in user can edit any order by ID
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(oid));
  if(!o) return layout('Not found', `<div class="alert alert-err">Order not found.</div><a href="/account/orders" class="btn btn-ghost btn-sm" style="margin-top:.5rem">← My orders</a>`, u);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(o.productId);
  return layout(`Edit Order #${o.id}`, `
    <div style="margin-bottom:1rem"><a href="/account/orders" class="small muted">← My orders</a></div>
    <div class="page-head"><h1>Edit Order #${o.id}</h1><p>${p ? esc(p.name) : 'Unknown product'}</p></div>
    ${msg ? `<div class="alert alert-ok">${esc(msg)}</div>` : ''}
    ${err ? `<div class="alert alert-err">${esc(err)}</div>` : ''}
    <div style="max-width:460px">
      <div class="card">
        <form method="POST" action="/orders/${o.id}/edit">
          <div class="field">
            <label>Quantity</label>
            <input type="number" name="quantity" value="${o.quantity}" min="1">
          </div>
          <div class="field">
            <label>Status</label>
            <!-- 🔴 ORD-2: status not validated — user can set to 'delivered', 'shipped', anything -->
            <select name="status">
              <option value="pending"   ${o.status==='pending'  ?'selected':''}>Pending</option>
              <option value="shipped"   ${o.status==='shipped'  ?'selected':''}>Shipped</option>
              <option value="delivered" ${o.status==='delivered'?'selected':''}>Delivered</option>
              <option value="cancelled" ${o.status==='cancelled'?'selected':''}>Cancelled</option>
              <option value="refunded"  ${o.status==='refunded' ?'selected':''}>Refunded</option>
            </select>
          </div>
          <div class="field">
            <label>Delivery Note</label>
            <!-- 🔴 XSS: note rendered raw in order detail -->
            <input type="text" name="note" value="${o.note||''}" placeholder="Add a delivery note…">
          </div>
          <div style="display:flex;gap:.75rem;margin-top:.5rem">
            <button type="submit" class="btn">Save Changes</button>
            <a href="/account/orders" class="btn btn-ghost">Cancel</a>
          </div>
        </form>
      </div>
    </div>`, u);
}

// ── Server ────────────────────────────────────────────────────────────────────
const server=http.createServer(async(req,res)=>{
  const parsed=url.parse(req.url,true);
  const path=parsed.pathname.replace(/\/+$/,'')||'/';
  const cookies=parseCookies(req);
  const sid=cookies['session'];
  let me = sid&&sessions[sid]
    ? db.prepare('SELECT * FROM users WHERE id = ?').get(sessions[sid]) || null
    : null;

  // 🔴 BAC-2: forged base64 token cookie
  if(!me&&cookies['token']){
    try{
      const d=Buffer.from(cookies['token'],'base64').toString('utf8');
      me = db.prepare('SELECT * FROM users WHERE username = ?').get(d) || null;
    }catch{}
  }

  function html(body,code=200){
    // 🔴 No CSP / X-Frame-Options / X-Content-Type-Options headers
    res.writeHead(code,{'Content-Type':'text/html;charset=utf-8'});
    res.end(body);
  }
  function redir(to){res.writeHead(302,{Location:to});res.end();}
  function isApi(){return (req.headers['accept']||'').includes('application/json')||(req.headers['content-type']||'').includes('application/json');}
  function json(obj,code=200){res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(obj,null,2));}

  if(req.method==='GET'&&path==='/') return html(pgHome(me));
  if(req.method==='GET'&&path==='/products') return html(pgProducts(me,parsed.query.category||null));
  if(req.method==='GET'&&path.match(/^\/products\/[^/]+$/)) return html(pgProductDetail(me,path.split('/')[2],parsed.query.msg,parsed.query.err));

  if(req.method==='POST'&&path.match(/^\/products\/(\d+)\/review$/)){
    if(!me) return redir('/login');
    const pid=Number(path.split('/')[2]);
    const b=await parseBody(req);
    if(!(b.text||'').trim()) return redir(`/products/${pid}?err=Review+text+is+required`);
    // 🔴 XSS-2: raw text stored in SQLite
    db.prepare('INSERT INTO reviews (productId, author, text, rating, date) VALUES (?, ?, ?, ?, ?)')
      .run(pid, me.username, b.text, Math.min(5,Math.max(1,Number(b.rating)||5)), new Date().toISOString().split('T')[0]);
    return redir(`/products/${pid}?msg=Review+posted!`);
  }

  if(req.method==='GET'&&path==='/search') return html(pgSearch(me,parsed.query.q!==undefined?parsed.query.q:null));
  if(req.method==='GET'&&path==='/welcome') return html(pgWelcome(me));
  if(req.method==='GET'&&path==='/login') return html(pgLogin(me, parsed.query.err||null));

  if(req.method==='POST'&&path==='/login'){
    const b=await parseBody(req);
    if(!(b.username||'').trim()||!(b.password||'').trim()){
      if(isApi()) return json({success:false,error:'Username and password are required.'},400);
      return redir('/login?err=Username+and+password+are+required.');
    }
    const found = db.prepare('SELECT * FROM users WHERE username = ?').get(b.username);
    // 🔴 INJ-2: raw username in error, not escaped
    if(!found){
      if(isApi()) return json({success:false,error:`No account found for: ${b.username}`},401);
      return redir('/login?err='+encodeURIComponent('No account found for: '+b.username));
    }
    // 🔴 CF-1: plaintext comparison
    if(found.password!==b.password){
      if(isApi()) return json({success:false,error:`Incorrect password for: ${b.username}`},401);
      return redir('/login?err='+encodeURIComponent('Incorrect password for: '+b.username));
    }
    const ns=Math.random().toString(36).slice(2)+Date.now().toString(36);
    sessions[ns]=found.id;
    // 🔴 CF-3: weak token cookie, no HttpOnly, no Secure
    if(isApi()){
      res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':[`session=${ns};Path=/`,`token=${tok(found.username)};Path=/`]});
      return res.end(JSON.stringify({success:true,message:'Login successful',user:{id:found.id,username:found.username,email:found.email,role:found.role},session:ns,token:tok(found.username)},null,2));
    }
    res.writeHead(302,{'Set-Cookie':[`session=${ns};Path=/`,`token=${tok(found.username)};Path=/`],Location:'/'});
    return res.end();
  }

  if(req.method==='GET'&&path==='/register') return html(pgRegister(me,null));

  if(req.method==='POST'&&path==='/register'){
    const b=await parseBody(req);
    if(!b.username||!b.password){
      if(isApi()) return json({success:false,error:'Username and password are required'},400);
      return html(pgRegister(null,'Username and password are required'));
    }
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(b.username);
    if(existing){
      if(isApi()) return json({success:false,error:'That username is already taken'},409);
      return html(pgRegister(null,'That username is already taken'));
    }
    // 🔴 BAC-3: role accepted from body
    const result = db.prepare('INSERT INTO users (username, email, password, role, balance) VALUES (?, ?, ?, ?, ?)')
      .run(b.username, b.email||'', b.password, b.role||'user', 100);
    if(isApi()) return json({success:true,message:'Account created successfully',userId:result.lastInsertRowid},201);
    return redir('/login');
  }

  if(req.method==='POST'&&path==='/orders'){
    if(!me){
      if(isApi()) return json({success:false,error:'Unauthorized — please login'},401);
      return redir('/login');
    }
    const b=await parseBody(req);
    const pid=Number(b.productId), qty=Number(b.quantity)||1;
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
    if(!p){
      if(isApi()) return json({success:false,error:'Product not found'},404);
      return redir('/products');
    }
    if(p.stock<qty){
      if(isApi()) return json({success:false,error:'Not enough stock'},400);
      return redir(`/products/${pid}?err=Not+enough+stock`);
    }
    db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, pid);
    const result = db.prepare('INSERT INTO orders (userId, productId, quantity, total, status, date) VALUES (?, ?, ?, ?, ?, ?)')
      .run(me.id, pid, qty, parseFloat((p.price*qty).toFixed(2)), 'pending', new Date().toISOString().split('T')[0]);
    if(isApi()) return json({success:true,message:'Order placed successfully',orderId:result.lastInsertRowid,product:p.name,quantity:qty,total:parseFloat((p.price*qty).toFixed(2))},201);
    return redir('/account/orders?msg=Order+placed+successfully!');
  }

  if(req.method==='GET'&&path==='/account/orders'){
    if(!me){
      if(isApi()) return json({success:false,error:'Unauthorized — please login'},401);
      return redir('/login');
    }
    // 🔴 BAC-1: userId from URL
    if(isApi()){
      const tid=parsed.query.userId?Number(parsed.query.userId):me.id;
      const orders=db.prepare('SELECT * FROM orders WHERE userId = ?').all(tid);
      return json({success:true,orders});
    }
    return html(pgOrders(me,parsed.query.userId,parsed.query.msg));
  }

  if(req.method==='GET'&&path.match(/^\/orders\/\d+$/)){
    if(!me) return redir('/login');
    return html(pgOrderDetail(me,path.split('/')[2]));
  }

  if(req.method==='GET'&&path==='/account/profile'){if(!me) return redir('/login');return html(pgProfile(me,parsed.query.msg));}

  if(req.method==='POST'&&path==='/account/profile'){
    if(!me){
      if(isApi()) return json({success:false,error:'Unauthorized — please login'},401);
      return redir('/login');
    }
    const b=await parseBody(req);
    // 🔴 BAC-3: role from form
    db.prepare('UPDATE users SET username = ?, email = ?, password = ?, role = ? WHERE id = ?')
      .run(
        b.username||me.username,
        b.email||me.email,
        b.password||me.password,
        b.role||me.role,
        me.id
      );
    if(isApi()) return json({success:true,message:'Profile updated successfully'});
    return redir('/account/profile?msg=Changes+saved!');
  }

  if(req.method==='GET'&&path==='/admin') return html(pgAdmin(me));

  // 🔴 CF-2: exposes DB credentials + admin secret
  if(req.method==='GET'&&path==='/health'){
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({status:'ok',version:'1.0.0',nodeVersion:process.version,environment:'production',uptime:process.uptime(),database:DB_CONFIG,adminSecret:ADMIN_SECRET},null,2));
  }

  if(req.method==='GET'&&path==='/logout'){
    if(sid) delete sessions[sid];
    if(isApi()){
      res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':['session=;Path=/;Max-Age=0','token=;Path=/;Max-Age=0']});
      return res.end(JSON.stringify({success:true,message:'Logged out successfully'},null,2));
    }
    res.writeHead(302,{'Set-Cookie':['session=;Path=/;Max-Age=0','token=;Path=/;Max-Age=0'],Location:'/'});
    return res.end();
  }

  if(req.method==='POST'&&path==='/test/reset'){
    // Re-seed data from db.js by reloading the module (for test resets)
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({success:true,note:'Reset not supported in SQLite mode. Restart the server to re-seed.'}));
  }

  // ── Cart routes ──────────────────────────────────────────────────────────────
  if(req.method==='GET'&&path==='/cart'){
    if(!me) return redir('/login');
    return html(pgCart(me, parsed.query.msg, parsed.query.err));
  }

  if(req.method==='POST'&&path==='/cart/add'){
    if(!me) return redir('/login');
    const b = await parseBody(req);
    if(!carts[me.id]) carts[me.id] = [];
    const pid = Number(b.productId);
    const existing = carts[me.id].find(i => i.productId === pid);
    if(existing){
      existing.quantity += 1;
    } else {
      // 🔴 CART-2: price taken directly from POST body — attacker can set price=0.01
      carts[me.id].push({
        productId: pid,
        name: b.name,          // 🔴 CART-1: name stored raw, rendered raw in cart
        price: Number(b.price),
        quantity: 1
      });
    }
    if(isApi()) return json({success:true,message:'Item added to cart',cart:carts[me.id]});
    return redir('/cart?msg=Item+added+to+cart!');
  }

  if(req.method==='POST'&&path==='/cart/update'){
    if(!me) return redir('/login');
    const b = await parseBody(req);
    const cart = carts[me.id] || [];
    const idx = Number(b.idx);
    if(cart[idx]){
      cart[idx].quantity = Math.max(1, Number(b.quantity)||1);
      // 🔴 CART-2: price overwritten from POST body on every update
      cart[idx].price = Number(b.price);
    }
    return redir('/cart?msg=Cart+updated!');
  }

  if(req.method==='POST'&&path==='/cart/remove'){
    if(!me) return redir('/login');
    const b = await parseBody(req);
    if(carts[me.id]) carts[me.id].splice(Number(b.idx), 1);
    return redir('/cart?msg=Item+removed.');
  }

  if(req.method==='POST'&&path==='/cart/checkout'){
    if(!me) return redir('/login');
    const cart = carts[me.id] || [];
    if(!cart.length) return redir('/cart?err=Your+cart+is+empty');
    const stmt = db.prepare('INSERT INTO orders (userId, productId, quantity, total, status, date) VALUES (?, ?, ?, ?, ?, ?)');
    for(const item of cart){
      // 🔴 CART-2: total calculated from attacker-controlled price
      stmt.run(me.id, item.productId, item.quantity, parseFloat((item.price * item.quantity).toFixed(2)), 'pending', new Date().toISOString().split('T')[0]);
    }
    carts[me.id] = [];
    if(isApi()) return json({success:true,message:'Order placed successfully'});
    return redir('/account/orders?msg=Order+placed+successfully!');
  }

  // ── Admin delete user ─────────────────────────────────────────────────────
  if(req.method==='POST'&&path==='/admin/delete-user'){
    // 🔴 ADM-1: No CSRF protection — any site can POST to this and delete users
    // 🔴 BAC: only checks role from session, but BAC-2 token cookie can bypass
    if(!me||me.role!=='admin') return html(layout('Forbidden',`<div class="alert alert-err">Admins only.</div>`,me),403);
    const b = await parseBody(req);
    const uid = Number(b.userId);
    if(uid === me.id) return redir('/admin?err=Cannot+delete+yourself');
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    if(isApi()) return json({success:true,message:`User ${uid} deleted successfully`});
    return redir('/admin?msg=User+deleted.');
  }

  // ── Edit order routes ─────────────────────────────────────────────────────
  if(req.method==='GET'&&path.match(/^\/orders\/\d+\/edit$/)){
    if(!me) return redir('/login');
    const oid = path.split('/')[2];
    return html(pgEditOrder(me, oid, parsed.query.msg, parsed.query.err));
  }

  if(req.method==='POST'&&path.match(/^\/orders\/\d+\/edit$/)){
    if(!me) return redir('/login');
    const oid = Number(path.split('/')[2]);
    const b = await parseBody(req);
    // 🔴 ORD-1: no ownership check — any user can edit any order by guessing ID
    // 🔴 ORD-2: status not validated — user can set 'delivered', 'refunded', etc.
    db.prepare('UPDATE orders SET quantity = ?, status = ?, note = ? WHERE id = ?')
      .run(Number(b.quantity)||1, b.status||'pending', b.note||'', oid);
    if(isApi()) return json({success:true,message:'Order updated successfully',orderId:oid});
    return redir(`/orders/${oid}/edit?msg=Order+updated!`);
  }

  html(layout('Not found',`
    <div class="alert alert-err" style="max-width:480px">Page not found: <strong>${esc(path)}</strong></div>
    <a href="/" class="btn btn-ghost btn-sm" style="margin-top:1rem">← Home</a>`,me),404);
});

server.listen(PORT,()=>{
  console.log('');
  console.log('  ⚠️  VULNERABLE WEB APP — FOR SECURITY TESTING ONLY');
  console.log('');
  console.log(`  🚀  http://localhost:${PORT}`);
  console.log('');
  console.log('  Accounts:  alice/alice123  ·  bob/bob12345  ·  admin/shopAdmin@99');
  console.log('');
  console.log('  Vulnerabilities:');
  console.log(`  XSS-1  Reflected   →  /products/<script>alert(1)</script>`);
  console.log(`  XSS-2  Stored      →  /products/1  post review with <img src=x onerror=alert(1)>`);
  console.log(`  XSS-3  DOM         →  /welcome#<svg onload=alert(1)>`);
  console.log(`  BAC-1  IDOR        →  /account/orders?userId=1`);
  console.log(`  BAC-2  FakeToken   →  set cookie token=${Buffer.from('admin').toString('base64')}`);
  console.log(`  BAC-3  PrivEsc     →  POST /register with role=admin in body`);
  console.log(`  CF-1   Plaintext   →  /admin (login as admin first)`);
  console.log(`  CF-2   DataLeak    →  /health`);
  console.log(`  CF-3   WeakToken   →  token cookie = btoa(username)`);
  console.log(`  INJ-1  SQLi        →  /search?q=%' UNION SELECT id,username,password,email,role,balance,emoji,description FROM users--`);
  console.log(`  INJ-2  HTMLInj     →  /login username: <b>test</b>`);
  console.log(`  CART-1 XSS Cart    →  /search → add item, intercept POST, set name=<img src=x onerror=alert(1)>`);
  console.log(`  CART-2 PriceManip  →  /search → add item, intercept POST, set price=0.01`);
  console.log(`  ADM-1  No CSRF     →  POST /admin/delete-user with userId=2 (no token needed)`);
  console.log(`  ORD-1  IDOR Edit   →  /orders/1/edit  (edit any order by ID)`);
  console.log(`  ORD-2  StatusTampr →  /orders/1/edit  set status=delivered`);
  console.log('');
  console.log(`  ZAP target: http://localhost:${PORT}`);
  console.log('');
});