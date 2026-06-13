/**
 * server.js — Entry point for vulnerable app
 * Place this inside: qa-cicd-practice/app/
 *
 * Run with: node app/server.js
 * App starts at: http://localhost:3000
 */

'use strict';

const { createApp } = require('./vulnerable_app');

const PORT = process.env.PORT || 3000;
const app  = createApp();

app.listen(PORT, () => {
  console.log('');
  console.log('⚠️  VULNERABLE APP RUNNING — FOR TESTING ONLY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🚀  App running at:  http://localhost:${PORT}`);
  console.log('');
  console.log('Available endpoints:');
  console.log(`  GET    http://localhost:${PORT}/health           ← V3 vuln`);
  console.log(`  POST   http://localhost:${PORT}/login            ← V5 vuln`);
  console.log(`  GET    http://localhost:${PORT}/admin/users      ← V6 vuln`);
  console.log(`  GET    http://localhost:${PORT}/products         ← safe`);
  console.log(`  POST   http://localhost:${PORT}/products         ← V7 vuln`);
  console.log(`  GET    http://localhost:${PORT}/products/:id     ← V4 vuln`);
  console.log(`  PUT    http://localhost:${PORT}/products/:id     ← V7 vuln`);
  console.log(`  DELETE http://localhost:${PORT}/products/:id     ← safe`);
  console.log(`  POST   http://localhost:${PORT}/orders           ← safe`);
  console.log(`  GET    http://localhost:${PORT}/orders/all       ← V8 vuln`);
  console.log(`  GET    http://localhost:${PORT}/orders/:userId   ← V2 vuln`);
  console.log(`  GET    http://localhost:${PORT}/orders/detail/:id← V1 vuln`);
  console.log('');
  console.log('Test credentials:');
  console.log('  alice / password123');
  console.log('  bob   / bob12345');
  console.log('  admin / admin123');
  console.log('');
  console.log('ZAP scan target: http://localhost:3000');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});