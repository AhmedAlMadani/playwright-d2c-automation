# 🧪 D2C Playwright Automation Framework

A **production-quality** QA automation framework built with [Playwright](https://playwright.dev/) and TypeScript, simulating a real-world **Direct-to-Consumer (D2C) SaaS subscription funnel**.

[![CI](https://github.com/your-org/playwright-d2c-automation/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/playwright-d2c-automation/actions/workflows/ci.yml)

---

## 📋 Table of Contents

- [Project Overview](#-project-overview)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Running Tests](#-running-tests)
- [Test Coverage](#-test-coverage)
- [State Machine](#-subscription-state-machine)
- [Design Decisions](#-design-decisions)
- [CI/CD](#-cicd)
- [Example Test Flow](#-example-test-flow)

---

## 🎯 Project Overview

This framework validates a complete SaaS subscription funnel:

```
User Journey
─────────────────────────────────────────────────────────────
1. User lands on product page
2. User signs up (via UI or API)
3. User selects a subscription plan
4. User completes checkout (mocked payment)
5. Subscription becomes active
6. User cancels subscription
7. Subscription state updates correctly (UI + API cross-validated)
```

**Key design philosophy:** Tests contain **no business logic** — only orchestration. All logic lives in the service and API layers, making tests readable by non-engineers and maintainable at scale.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          TEST LAYER                             │
│   specs in src/tests/{e2e,api,negative,edge}                    │
│   Pure orchestration — imports from fixtures only               │
└────────────────────────┬────────────────────────────────────────┘
                         │ uses
┌────────────────────────▼────────────────────────────────────────┐
│                       FIXTURE LAYER                             │
│   src/fixtures/index.ts                                         │
│   Pre-wired page objects + services + utilities                 │
│   DB reset (beforeEach) for full test isolation                 │
└──────────────┬─────────────────────────────┬────────────────────┘
               │ page objects                │ business services
┌──────────────▼──────────────┐  ┌───────────▼────────────────────┐
│       PAGE OBJECT LAYER     │  │       SERVICE LAYER            │
│  src/pages/                 │  │  src/services/                 │
│  - LandingPage              │  │  - UserService                 │
│  - SignupPage               │  │  - SubscriptionService         │
│  - PricingPage              │  │    └─ state-machine validation │
│  - CheckoutPage             │  └───────────┬────────────────────┘
│  - DashboardPage            │              │ delegates to
└─────────────────────────────┘  ┌───────────▼────────────────────┐
                                 │       API LAYER                │
                                 │  src/api/                      │
                                 │  - ApiClient (Supabase queries)│
                                 │  - UserApiService              │
                                 │  - SubscriptionApiService      │
                                 └───────────┬────────────────────┘
                                             │
                                 ┌───────────▼────────────────────┐
                                 │       DB LAYER                 │
                                 │  src/db/                       │
                                 │  - supabaseClient.ts (singleton│
                                 │  - dbCleanup.ts (test isolation│
                                 └───────────┬────────────────────┘
                                             │
                                 ┌───────────▼────────────────────┐
                                 │       SUPABASE (PostgreSQL)    │
                                 │  tables: users, subscriptions, │
                                 │          payments              │
                                 └────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Responsibility |
|-------|---------------|
| **Tests** | Orchestration only — describe what should happen |
| **Fixtures** | Dependency injection — wire everything, clean DB before each test |
| **Pages (POM)** | UI interaction abstraction — Playwright selectors |
| **Services** | Business logic — state machine, validation, error handling |
| **API Layer** | Supabase query abstraction — data creation and retrieval |
| **DB Layer** | Singleton client + test isolation utilities |
| **Utils** | Stateless helpers — data generation, mocking, logging |

---

## 📁 Project Structure

```
playwright-d2c-automation/
├── .github/
│   └── workflows/
│       └── ci.yml               # Multi-job CI pipeline
├── src/
│   ├── api/
│   │   ├── apiClient.ts         # Base client — Supabase queries
│   │   ├── subscriptionService.ts # Subscription API operations
│   │   └── userService.ts       # User API operations
│   ├── config/
│   │   └── environment.ts       # Env var loading + defaults
│   ├── db/
│   │   ├── supabaseClient.ts    # Supabase singleton (API layer only)
│   │   └── dbCleanup.ts         # Test isolation — cleans tables beforeEach
│   ├── fixtures/
│   │   └── index.ts             # Custom Playwright test fixtures
│   ├── pages/
│   │   ├── landingPage.ts
│   │   ├── signupPage.ts
│   │   ├── pricingPage.ts
│   │   ├── checkoutPage.ts
│   │   └── dashboardPage.ts
│   ├── services/
│   │   ├── UserService.ts       # Business-logic user orchestration
│   │   └── SubscriptionService.ts # Business-logic + state machine
│   ├── tests/
│   │   ├── api/
│   │   │   └── subscription.spec.ts   # API schema + logic tests
│   │   ├── e2e/
│   │   │   ├── checkout.spec.ts       # Full checkout happy path
│   │   │   └── subscriptionLifecycle.spec.ts  # Cancel + cross-validate
│   │   ├── edge/
│   │   │   └── edgeCases.spec.ts      # Duplicates, rapid transitions
│   │   └── negative/
│   │       └── payment.spec.ts        # Failure scenarios
│   ├── types/
│   │   └── api.ts               # Shared TypeScript interfaces
│   └── utils/
│       ├── dataFactory.ts       # Faker-powered test data generation
│       ├── logger.ts            # Structured console logger
│       └── paymentMock.ts       # Deterministic payment simulation
├── .env.example                 # Environment variable template
├── .gitignore
├── package.json
├── playwright.config.ts
├── tsconfig.json
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/playwright-d2c-automation.git
cd playwright-d2c-automation

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install --with-deps

# Copy and configure environment variables
cp .env.example .env
# Edit .env and fill in SUPABASE_URL and SUPABASE_ANON_KEY
```

---

## 🗄️ Supabase Integration

This framework uses [Supabase](https://supabase.com) (PostgreSQL) as the real backend database, replacing the original in-memory mock. The integration is contained entirely within the **API and DB layers** — tests, services, and page objects have zero awareness of Supabase.

### Setup

1. Create a free project at [supabase.com](https://supabase.com)
2. Run the schema SQL (see below) in **SQL Editor → New query**
3. Copy credentials from **Project Settings → API**
4. Add them to `.env`:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<your-anon-key>
```

### Database Schema

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password text not null,
  created_at timestamp default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  plan text not null,
  state text check (state in ('inactive','trial','active','past_due','canceled')),
  created_at timestamp default now(),
  updated_at timestamp default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  status text check (status in ('success','failed')),
  amount numeric,
  created_at timestamp default now()
);
```

### Anon Key vs Service Role Key

| Key | Use |
|-----|-----|
| `anon` (publishable) | ✅ All test operations — safe to commit to CI secrets |
| `service_role` | ❌ Never use in tests — bypasses all security |

### Test Isolation Strategy

Before every test, `beforeEach` calls `cleanDatabase()` which deletes all rows from `payments`, `subscriptions`, and `users` in FK-safe order. No shared state ever leaks between tests.

### CI/CD Secrets

Add both vars as **Repository Secrets**: `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

> Settings → Secrets and variables → Actions → New repository secret

---

## ▶️ Running Tests

```bash
# Run all tests
npm test

# Run only smoke tests (critical path)
npm run test:smoke

# Run full regression suite
npm run test:regression

# Run by category
npm run test:e2e
npm run test:api
npm run test:negative
npm run test:edge

# Run with browser UI visible
npm run test:headed

# Open HTML report after a run
npm run test:report

# Type-check without running tests
npm run typecheck
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3000` | UI base URL |
| `API_URL` | `http://localhost:3001` | API base URL |
| `DEBUG_MODE` | `false` | Enable verbose debug logging |
| `CI` | unset | Set by GitHub Actions automatically |

---

## 🧪 Test Coverage

| Suite | Tags | What It Tests |
|-------|------|---------------|
| `e2e/checkout.spec.ts` | `@smoke @regression` | Full UI checkout flow, plan selection, API cross-validation |
| `e2e/subscriptionLifecycle.spec.ts` | `@smoke @regression` | Cancel flow, state transitions, double-cancel prevention |
| `api/subscription.spec.ts` | `@regression` | Schema validation, state machine matrix, duplicate rejection |
| `negative/payment.spec.ts` | `@regression` | Declined card, expired card, insufficient funds, invalid inputs |
| `edge/edgeCases.spec.ts` | `@regression` | Duplicate subscriptions, rapid transitions, data isolation |

### API + UI Cross-Validation

All E2E tests follow this pattern:

```
Create data via API  →  Validate via UI  →  Cross-check via API
```

This ensures the UI correctly reflects the backend state and prevents silent discrepancies.

---

## 🔄 Subscription State Machine

```
                  ┌──────────┐
     ┌────────────►  trial   ├──────────────┐
     │            └────┬─────┘              │
     │                 │                    │
┌────┴─────┐           │              ┌─────▼──────┐
│ inactive │           ▼              │  canceled  │ (terminal)
└────┬─────┘      ┌────────┐         └────────────┘
     │            │ active ├───────────────►▲
     └────────────►        │               │
                  └────┬───┘          ┌────┴──────┐
                       │              │ past_due  │
                       └──────────────►           ├────────► canceled
                                     └───────────┘
```

**Valid transitions:**

| From | To |
|------|----|
| `inactive` | `trial`, `active` |
| `trial` | `active`, `canceled` |
| `active` | `past_due`, `canceled` |
| `past_due` | `active`, `canceled` |
| `canceled` | *(none — terminal state)* |

Invalid transitions are enforced at the service layer and tested exhaustively in `api/subscription.spec.ts`.

---

## 💡 Design Decisions

### 1. In-Memory Mock Database
Real HTTP endpoints would require a running server, creating fragile test infrastructure. Instead, `ApiClient` maintains an in-memory store that is **reset before every test** via the fixture `beforeEach` hook. Tests are completely isolated with no flakiness from shared state.

### 2. Service Layer Separation
The prompt requires both an "API layer" and a "service layer". The distinction:
- **API layer** (`src/api/`) — knows *how* to talk to the backend (request/response)
- **Service layer** (`src/services/`) — knows *when and why* (business rules, validation)

This keeps both layers independently testable and replaceable.

### 3. Deterministic Payment Mock
Using `Math.random()` in tests causes non-determinism. `PaymentMock` provides fixed card numbers (modelled after Stripe's test card convention) so payment scenarios are 100% predictable.

### 4. Fixtures as the Dependency Injection Mechanism
Playwright's `test.extend()` is used as a lightweight DI container. All page objects, services, and utilities are pre-instantiated per-test with zero boilerplate in spec files.

### 5. Test Tagging
`@smoke` — critical happy-path tests. Run on every push.  
`@regression` — full suite. Run on PRs and protected branches.

---

## 🔧 CI/CD

The pipeline has 4 independent jobs:

```
push / PR
    │
    ├── typecheck        # TypeScript gate (fast, ~30s)
    │
    ├── smoke            # @smoke tests, Chromium only (~2min)
    │
    ├── regression       # @regression × {chromium, firefox, webkit} (~10min)
    │   └── matrix
    │
    └── api-tests        # API-only tests, no browser UI (~1min)
```

- HTML reports uploaded as GitHub Actions artifacts (7–14 day retention)
- Traces uploaded on failure for debugging
- Concurrency cancellation prevents stale run queues

---

## 📖 Example Test Flow

```typescript
// From: src/tests/e2e/checkout.spec.ts

test('should complete full checkout and activate subscription', async ({
  userService,        // ← injected by fixture
  subscriptionService,
  landingPage,
  pricingPage,
  checkoutPage,
  dashboardPage,
}) => {
  // 1. Create user via API (fast, no UI needed for setup)
  const userData = DataFactory.generateUserData('SecurePass1!');
  const user = await userService.createUser(userData.email, userData.password);

  // 2. Navigate UI flow
  await landingPage.goto();
  await landingPage.clickSignUp();
  await pricingPage.selectPlan('Premium');

  // 3. Complete checkout with deterministic success card
  const card = PaymentMock.getSuccessCard();
  await checkoutPage.fillPaymentDetails(card.cardNumber, card.expiry, card.cvv);
  await checkoutPage.completePurchase();
  await checkoutPage.expectPurchaseSuccess();

  // 4. Validate UI state
  await dashboardPage.expectSubscriptionStatus('active');

  // 5. Cross-validate via API
  const subscription = await subscriptionService.getStatus(user.id);
  expect(subscription.state).toBe('active');
});
```

Every test reads like a specification. No selectors, no HTTP calls, no setup boilerplate — all handled by the framework.
