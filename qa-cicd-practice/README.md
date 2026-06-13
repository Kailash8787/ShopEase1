# QA Automation Practice Project

A complete CI/CD project where **every developer push automatically triggers your automation tests**.  
If tests fail → build fails → PR is blocked. If tests pass → build succeeds → PR can merge.

---

## 🗂️ Project Structure

```
qa-cicd-practice/
│
├── app/
│   ├── index.js          ← The application (E-Commerce API, zero npm deps)
│   └── server.js         ← HTTP server entry point
│
├── tests/
│   ├── helpers/
│   │   └── client.js     ← Tiny HTTP test client (no supertest needed)
│   ├── unit/
│   │   └── products.test.js      ← 16 unit tests (for jest)
│   ├── integration/
│   │   └── orders.test.js        ← 11 integration tests (for jest)
│   └── e2e/
│       └── user-journeys.test.js ← 6 E2E journey tests (for jest)
│
├── scripts/
│   └── run-tests.js      ← 🔑 Local runner, zero npm needed (33 tests)
│
├── .github/
│   └── workflows/
│       └── qa-pipeline.yml  ← 🔑 GitHub Actions pipeline
│
└── package.json          ← jest + supertest (for CI, after npm install)
```

---

## 🚀 Quick Start — Run Tests Right Now (No npm install needed)

```bash
# Clone or create the project, then:
node scripts/run-tests.js          # run all 33 tests
node scripts/run-tests.js unit     # unit tests only
node scripts/run-tests.js integration
node scripts/run-tests.js e2e
```

**Exit codes:**
- `0` → all tests passed → ✅ build succeeds
- `1` → tests failed → ❌ build fails

---

## 🔌 The API Being Tested

A simple E-Commerce REST API:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | System health check |
| GET | `/products` | List all products |
| GET | `/products?category=X` | Filter by category |
| GET | `/products/:id` | Get single product |
| POST | `/products` | Create a product |
| PUT | `/products/:id` | Update a product |
| DELETE | `/products/:id` | Remove a product |
| POST | `/orders` | Place an order |
| GET | `/orders/:userId` | Get user's orders |
| GET | `/orders/detail/:id` | Get order by ID |
| POST | `/test/reset` | Reset to seed data (test utility) |

---

## ⚡ How the CI/CD Pipeline Works

```
Developer pushes code
         │
         ▼
┌─────────────────────────────────┐
│  🧪 JOB 1: Unit Tests           │  ← EVERY push on every branch
│  16 tests | ~10 seconds         │    Fast feedback within 1 minute
│  ❌ Any fail → BUILD FAILS      │
└────────────────┬────────────────┘
                 │  (only if unit tests passed)
         [PR to main/develop]
                 │
                 ▼
┌─────────────────────────────────┐
│  🔗 JOB 2: Integration Tests    │  ← PRs + main/develop pushes
│  11 tests | ~15 seconds         │
│  ❌ Any fail → BUILD FAILS      │
└────────────────┬────────────────┘
                 │  (only if integration passed)
         [Merge to main]
                 │
                 ▼
┌─────────────────────────────────┐
│  🎭 JOB 3: E2E Tests            │  ← main branch + nightly
│  6 journey tests | ~30 seconds  │
│  ❌ Any fail → BUILD FAILS      │
└────────────────┬────────────────┘
                 │  (only if ALL tests passed)
         [main branch only]
                 │
                 ▼
┌─────────────────────────────────┐
│  🏗️ JOB 4: Build Artifact       │  ← Packages the app for deployment
│  Creates versioned tarball       │
│  ✅ This is your "green build"   │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│  📣 JOB 5: PR Comment           │  ← Posts results table to PR
│  ✅ Safe to merge               │
│  OR ❌ Do not merge             │
└─────────────────────────────────┘
```

---

## 🧪 The Three Test Layers

### Layer 1 — Unit Tests (`tests/unit/products.test.js`)
Tests individual API endpoints in isolation.  
**When they run:** Every push to every branch.  
**Speed:** ~1–2 seconds.

What's tested:
- `GET /products` — returns all products, category filter
- `GET /products/:id` — found/not found
- `POST /products` — valid creation, validation (missing name, negative price, fractional stock, missing category)
- `PUT /products/:id` — partial updates, 404
- `DELETE /products/:id` — removes product, 404

### Layer 2 — Integration Tests (`tests/integration/orders.test.js`)
Tests multiple components working together (orders + product inventory).  
**When they run:** PRs and merges to main/develop.  
**Speed:** ~3–5 seconds.

What's tested:
- Order creation deducts stock from product
- Failed order doesn't corrupt stock
- Order total calculated correctly
- User orders are isolated per userId
- Full workflow: create product → place order → verify stock reduced

### Layer 3 — E2E Tests (`tests/e2e/user-journeys.test.js`)
Tests complete user journeys end-to-end.  
**When they run:** Merges to main, nightly.  
**Speed:** ~5–10 seconds.

What's tested:
- Journey 1: Customer browses → filters → views product → places order → checks order history
- Journey 2: Admin creates → discounts → restocks → discontinues product
- Journey 3: Multiple concurrent customers have isolated data
- Journey 4: System stays consistent after bad requests
- Journey 5: Pre-deploy smoke test (all endpoints reachable, transaction < 500ms)

---

## 🛠️ Practice Exercises

### Exercise 1 — Make a test fail on purpose (simulate a developer bug)

Open `app/index.js` and find this line in the `validateProduct` function:
```javascript
if (typeof price !== 'number' || price < 0) return 'Price must be a non-negative number';
```

Change it to this (introduce a bug):
```javascript
if (typeof price !== 'number' || price < -999) return 'Price must be a non-negative number';
```

Now run the tests:
```bash
node scripts/run-tests.js unit
```

You'll see:
```
✗ POST /products → rejects negative price (400)
  → 201 !== 400

❌ BUILD FAILED — 1 test(s) failed.
```

In GitHub Actions, this would block the PR from merging.

**Fix:** Revert the change and push again. The pipeline turns green. ✅

---

### Exercise 2 — Add a new test

Open `tests/unit/products.test.js` and add this test inside the `PUT /products/:id` describe block:

```javascript
test('PUT /products/:id → rejects negative stock — 400', async () => {
  const res = await api.put('/products/1', { stock: -5 });
  expect(res.status).toBe(400);
});
```

Run the tests and see if the app correctly rejects negative stock updates.

---

### Exercise 3 — Trigger the pipeline via GitHub

1. Push this project to a GitHub repository
2. Go to GitHub → Settings → Branches → Add rule for `main`
3. Check **"Require status checks to pass before merging"**
4. Select: `🧪 Unit Tests`, `🔗 Integration Tests`
5. Now create a feature branch, make a small change, open a PR
6. Watch the pipeline run automatically in the GitHub Actions tab
7. See the bot comment appear on your PR with the test results table

---

### Exercise 4 — Break and fix E2E

In `tests/e2e/user-journeys.test.js`, find Journey 5:
```javascript
assert.ok(Date.now() - start < 500, 'Transaction took too long');
```

Change `500` to `1` (impossible threshold):
```javascript
assert.ok(Date.now() - start < 1, 'Transaction took too long');
```

Run `node scripts/run-tests.js e2e` — the E2E job fails.  
This would block a main branch build from creating a deployable artifact.  
Revert and push to fix it.

---

## 📋 Pipeline Trigger Reference

| Action | Unit | Integration | E2E | Build |
|--------|------|-------------|-----|-------|
| Push to feature branch | ✅ | ⏭ | ⏭ | ⏭ |
| Open PR to main/develop | ✅ | ✅ | ⏭ | ⏭ |
| Merge to main | ✅ | ✅ | ✅ | ✅ |
| Nightly (2am UTC) | ✅ | ✅ | ✅ | ⏭ |
| Manual trigger | ✅ | ✅ | ✅ | ⏭ |

---

## ⚙️ GitHub Repository Setup

After pushing to GitHub:

1. **Branch Protection** (Settings → Branches → Add rule for `main`):
   - ✅ Require status checks to pass
   - Select: `🧪 Unit Tests`, `🔗 Integration Tests`
   - ✅ Require branches to be up to date before merging
   - ✅ Do not allow bypassing the above settings

2. **Required Secrets** (Settings → Secrets and variables → Actions):
   - None required for the base pipeline
   - Add `SLACK_WEBHOOK_URL` if you want Slack notifications

---

## 🧰 Running with Jest (after npm install)

If you have Node.js and npm available:

```bash
npm install
npm test                  # all tests
npm run test:unit         # unit only
npm run test:integration  # integration only
npm run test:e2e          # E2E only
npm run test:coverage     # with coverage report
```
