'use strict';
const express = require('express');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Session store ────────────────────────────────────────────────────────────
const sessions = new Map();

function getSid(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)sid=([^;]+)/);
  return m ? m[1] : null;
}
function getSession(req)          { const id = getSid(req); return id ? sessions.get(id) : null; }
function setSession(res, data)    { const id = crypto.randomUUID(); sessions.set(id, data); res.setHeader('Set-Cookie', `sid=${id}; Path=/; HttpOnly`); }
function patchSession(req, patch) { const id = getSid(req); if (id) sessions.set(id, { ...sessions.get(id), ...patch }); }

// ── Payment simulation ───────────────────────────────────────────────────────
const CARDS = {
  '4242424242424242': null,
  '4000000000000002': 'Your card was declined.',
  '4000000000000069': 'Your card has expired.',
  '4000000000009995': 'Your card has insufficient funds.',
};
function pay(raw) { return CARDS[raw.replace(/\s/g, '')] ?? null; }

// ── Shared styles ────────────────────────────────────────────────────────────
const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0f0f1a;color:#e0e0f0;min-height:100vh}
nav{display:flex;align-items:center;justify-content:space-between;padding:1rem 2rem;background:rgba(255,255,255,.05);border-bottom:1px solid rgba(255,255,255,.1)}
nav .logo{font-size:1.3rem;font-weight:700;background:linear-gradient(135deg,#7c3aed,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
nav a{color:#a5b4fc;text-decoration:none;margin-left:1.2rem;font-size:.9rem}
nav a:hover{color:#fff}
.wrap{max-width:460px;margin:4rem auto;padding:0 1.5rem}
.card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:2.5rem}
h1{font-size:1.7rem;font-weight:700;margin-bottom:.4rem}
.sub{color:#94a3b8;margin-bottom:1.8rem;font-size:.9rem}
.fg{margin-bottom:1.1rem}
label{display:block;font-size:.85rem;color:#a5b4fc;margin-bottom:.35rem;font-weight:500}
input{width:100%;padding:.7rem 1rem;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#e0e0f0;font-size:.95rem;outline:none}
input:focus{border-color:#7c3aed}
.btn{display:block;width:100%;padding:.85rem;background:linear-gradient(135deg,#7c3aed,#06b6d4);border:none;border-radius:10px;color:#fff;font-size:1rem;font-weight:600;cursor:pointer;margin-top:.5rem;text-align:center;text-decoration:none}
.btn:hover{opacity:.9}
.btn-outline{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#e0e0f0}
.error-message{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);border-radius:8px;padding:.7rem 1rem;color:#fca5a5;font-size:.9rem;margin-bottom:1rem}
.success-message{background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.4);border-radius:8px;padding:.7rem 1rem;color:#86efac;font-size:.9rem;margin-bottom:1rem}
.link{color:#7c3aed;text-decoration:none}
.note{margin-top:1.2rem;text-align:center;color:#94a3b8;font-size:.85rem}
/* Pricing */
.pg{display:grid;grid-template-columns:repeat(3,1fr);gap:1.2rem;max-width:860px;margin:3rem auto;padding:0 1.5rem}
.pc{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:1.8rem;text-align:center;transition:border-color .2s,transform .2s}
.pc:hover{border-color:#7c3aed;transform:translateY(-3px)}
.pc.hot{border-color:#7c3aed;background:rgba(124,58,237,.08)}
.pn{font-size:1.1rem;font-weight:700;margin-bottom:.4rem}
.pp{font-size:2.2rem;font-weight:800;background:linear-gradient(135deg,#7c3aed,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin:.8rem 0}
.pp s{font-size:.85rem;font-weight:400;color:#94a3b8}
.pf{list-style:none;color:#94a3b8;font-size:.85rem;margin-bottom:1.4rem;line-height:1.9}
.pf li::before{content:"✓ "}
/* Dashboard */
.stat{background:rgba(124,58,237,.12);border:1px solid rgba(124,58,237,.3);border-radius:12px;padding:1.2rem 1.5rem;margin-bottom:1.5rem}
.stat-label{font-size:.8rem;color:#a5b4fc;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.3rem}
#subscription-status{font-size:1.4rem;font-weight:700}
.status-active{color:#34d399}
.status-canceled{color:#f87171}
.status-trial{color:#60a5fa}
.status-past_due{color:#fbbf24}
.status-inactive{color:#94a3b8}
.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);align-items:center;justify-content:center;z-index:100}
.modal.open{display:flex}
.modal-box{background:#1e1e2e;border:1px solid rgba(255,255,255,.15);border-radius:16px;padding:2rem;max-width:380px;width:90%;text-align:center}
.modal-box h2{margin-bottom:.8rem}
.modal-box p{color:#94a3b8;margin-bottom:1.5rem;font-size:.9rem}
.modal-actions{display:flex;gap:.8rem}
.modal-actions .btn{flex:1}
`;

function nav(session) {
  return `<nav>
    <span class="logo">⚡ SubFlow</span>
    <div>${session
      ? `<a href="/dashboard">Dashboard</a><a href="/pricing">Plans</a>`
      : `<a href="/pricing">Pricing</a><a href="/signup">Sign Up</a><a href="/login">Login</a>`
    }</div>
  </nav>`;
}

function page(title, body, extraHead = '') {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>${CSS}</style>${extraHead}</head><body>${body}</body></html>`;
}

// ── GET / ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const s = getSession(req);
  res.send(page('Welcome to SubFlow – Modern SaaS Subscriptions', `
  ${nav(s)}
  <div style="text-align:center;padding:6rem 1.5rem">
    <h1 style="font-size:2.8rem;font-weight:800;background:linear-gradient(135deg,#7c3aed,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:1rem">
      Subscriptions,<br>Simplified.
    </h1>
    <p style="color:#94a3b8;font-size:1.1rem;max-width:500px;margin:0 auto 2.5rem">
      Start free, scale as you grow. Cancel anytime.
    </p>
    <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap">
      <a href="/signup" class="btn" style="width:auto;padding:.85rem 2rem">Get Started</a>
      <a href="/login"  class="btn btn-outline" style="width:auto;padding:.85rem 2rem">Login</a>
    </div>
  </div>`));
});

// ── GET /signup ──────────────────────────────────────────────────────────────
app.get('/signup', (req, res) => {
  if (getSession(req)) return res.redirect('/dashboard');
  const err = req.query.error ? `<div class="error-message">${decodeURIComponent(req.query.error)}</div>` : '';
  res.send(page('Sign Up – SubFlow', `
  ${nav(null)}
  <div class="wrap"><div class="card">
    <h1>Create Account</h1><p class="sub">14-day free trial. No credit card required.</p>
    ${err}
    <form method="POST" action="/signup" novalidate>
      <div class="fg"><label for="email">Email</label>
        <input id="email" name="email" type="email" placeholder="you@company.com"></div>
      <div class="fg"><label for="password">Password</label>
        <input id="password" name="password" type="password" placeholder="Min. 8 characters"></div>
      <div class="fg"><label for="confirm-password">Confirm Password</label>
        <input id="confirm-password" name="confirmPassword" type="password" placeholder="Repeat password"></div>
      <button class="btn" type="submit">Sign Up</button>
    </form>
    <p class="note">Already have an account? <a href="/login" class="link">Login</a></p>
  </div></div>`));
});

// ── POST /signup ─────────────────────────────────────────────────────────────
app.post('/signup', (req, res) => {
  const { email = '', password = '', confirmPassword = '' } = req.body;
  const redir = e => res.redirect('/signup?error=' + encodeURIComponent(e));
  if (!email.trim())                              return redir('Email is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return redir('Invalid email address');
  if (!password.trim())                           return redir('Password is required');
  if (password.length < 6)                        return redir('Password must be at least 6 characters');
  if (password !== confirmPassword)               return redir('Passwords do not match');
  setSession(res, { email, subscription: null });
  res.redirect('/pricing');
});

// ── GET /login ───────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (getSession(req)) return res.redirect('/dashboard');
  res.send(page('Login – SubFlow', `
  ${nav(null)}
  <div class="wrap"><div class="card">
    <h1>Welcome Back</h1><p class="sub">Sign in to manage your subscription.</p>
    <form method="POST" action="/login">
      <div class="fg"><label for="email">Email</label>
        <input id="email" name="email" type="email" placeholder="you@company.com"></div>
      <div class="fg"><label for="password">Password</label>
        <input id="password" name="password" type="password" placeholder="Your password"></div>
      <button class="btn" type="submit">Login</button>
    </form>
  </div></div>`));
});

app.post('/login', (req, res) => {
  setSession(res, { email: req.body.email, subscription: null });
  res.redirect('/dashboard');
});

// ── GET /pricing ─────────────────────────────────────────────────────────────
app.get('/pricing', (req, res) => {
  const s = getSession(req);
  function plan(name, price, features, hot = false) {
    const slug = name.toLowerCase();
    return `<div class="pc${hot ? ' hot' : ''}">
      <div class="pn">${name}</div>
      <div class="pp">$${price}<s>/mo</s></div>
      <ul class="pf">${features.map(f => `<li>${f}</li>`).join('')}</ul>
      <button class="btn" onclick="location.href='/checkout?plan=${slug}'">Select ${name}</button>
    </div>`;
  }
  res.send(page('Pricing – Choose Your Plan – SubFlow', `
  ${nav(s)}
  <div style="text-align:center;padding:2.5rem 0 0">
    <h1 style="font-size:2rem;font-weight:800">Simple, Honest Pricing</h1>
    <p style="color:#94a3b8;margin-top:.5rem">Start free. Upgrade when you're ready.</p>
  </div>
  <div class="pg">
    ${plan('Basic',   '9',  ['Up to 1,000 requests','Email support','Basic analytics'])}
    ${plan('Premium', '29', ['Unlimited requests','Priority support','Advanced analytics','Custom domains'], true)}
    ${plan('Enterprise','99',['Everything in Premium','SLA guarantee','Dedicated manager','SSO & SAML'])}
  </div>`));
});

// ── GET /checkout ─────────────────────────────────────────────────────────────
app.get('/checkout', (req, res) => {
  const s = getSession(req);
  if (!s) return res.redirect('/signup');
  const plan = req.query.plan || 'premium';
  const err  = req.query.error ? `<div class="error-message">${decodeURIComponent(req.query.error)}</div>` : '';
  const prices = { basic: '9.99', premium: '29.99', enterprise: '99.99' };
  const price  = prices[plan] || '29.99';
  res.send(page('Checkout – Complete Your Purchase – SubFlow', `
  ${nav(s)}
  <div class="wrap"><div class="card">
    <h1>Complete Checkout</h1>
    <p class="sub">Plan: <strong style="color:#a5b4fc;text-transform:capitalize">${plan}</strong> — $${price}/month</p>
    ${err}
    <form method="POST" action="/checkout">
      <input type="hidden" name="plan"  value="${plan}">
      <input type="hidden" name="price" value="${price}">
      <div class="fg"><label for="card-number">Card Number</label>
        <input id="card-number" name="cardNumber" placeholder="4242 4242 4242 4242" maxlength="19"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
        <div class="fg"><label for="expiry">Expiry Date</label>
          <input id="expiry" name="expiry" placeholder="MM/YY" maxlength="5"></div>
        <div class="fg"><label for="cvv">CVV</label>
          <input id="cvv" name="cvv" placeholder="123" maxlength="4"></div>
      </div>
      <button class="btn" type="submit">Complete Purchase</button>
    </form>
  </div></div>`));
});

// ── POST /checkout ────────────────────────────────────────────────────────────
app.post('/checkout', (req, res) => {
  const s = getSession(req);
  if (!s) return res.redirect('/signup');
  const { cardNumber = '', plan, price } = req.body;
  const payErr = pay(cardNumber);
  if (payErr) {
    return res.redirect('/checkout?plan=' + encodeURIComponent(plan) + '&error=' + encodeURIComponent(payErr));
  }
  patchSession(req, { subscription: { plan, price, state: 'active' } });
  res.redirect('/dashboard?activated=1');
});

// ── GET /dashboard ────────────────────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
  const s = getSession(req);
  if (!s) return res.redirect('/signup');
  const sub      = s.subscription;
  const state    = sub ? sub.state : 'inactive';
  const label    = state === 'active'   ? 'Active'
                 : state === 'canceled' ? 'Canceled'
                 : state === 'trial'    ? 'Trial'
                 : state === 'past_due' ? 'Past Due'
                 : 'Inactive';
  const activated = req.query.activated === '1';
  const cancelled = req.query.cancelled === '1';
  const successMsg = activated ? 'Subscription activated!'
                   : cancelled ? 'Subscription canceled successfully.'
                   : '';
  const canCancel = sub && (state === 'active' || state === 'past_due' || state === 'trial');

  res.send(page('Dashboard – SubFlow', `
  ${nav(s)}
  <div class="wrap">
    <h1 style="margin-bottom:1.5rem">Your Dashboard</h1>
    ${successMsg ? `<div class="success-message">${successMsg}</div>` : ''}
    <div class="stat">
      <div class="stat-label">Subscription Status</div>
      <div id="subscription-status" class="status-${state}">${label}</div>
      ${sub ? `<div style="color:#64748b;font-size:.8rem;margin-top:.3rem;text-transform:capitalize">Plan: ${sub.plan} · $${sub.price}/mo</div>` : ''}
    </div>
    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:1.2rem 1.5rem;margin-bottom:1.5rem">
      <div style="font-size:.8rem;color:#a5b4fc;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.5rem">Account</div>
      <div style="color:#94a3b8;font-size:.9rem">${s.email}</div>
    </div>
    ${canCancel ? `<button class="btn btn-outline" onclick="document.getElementById('cancel-modal').classList.add('open')" style="color:#f87171;border-color:rgba(248,113,113,.4)">Cancel Subscription</button>` : ''}
    ${!sub ? `<a href="/pricing" class="btn">Choose a Plan</a>` : ''}
  </div>

  <!-- Cancellation confirmation modal -->
  <div id="cancel-modal" class="modal">
    <div class="modal-box">
      <h2>Cancel Subscription?</h2>
      <p>Your access will continue until the end of the billing period. This cannot be undone.</p>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="document.getElementById('cancel-modal').classList.remove('open')">Keep Plan</button>
        <form method="POST" action="/dashboard/cancel" style="flex:1">
          <button class="btn" type="submit" style="background:linear-gradient(135deg,#dc2626,#b91c1c)">Confirm Cancellation</button>
        </form>
      </div>
    </div>
  </div>`));
});

// ── POST /dashboard/cancel ───────────────────────────────────────────────────
app.post('/dashboard/cancel', (req, res) => {
  const s = getSession(req);
  if (!s) return res.redirect('/signup');
  if (s.subscription) {
    patchSession(req, { subscription: { ...s.subscription, state: 'canceled' } });
  }
  res.redirect('/dashboard?cancelled=1');
});

// ── POST /__test__/session ── test-only backdoor ────────────────────────────
// Allows tests to establish an authenticated UI session without going through
// the signup form. NEVER expose this in a real application.
app.post('/__test__/session', (req, res) => {
  const { email = 'test@example.com', plan, price, state } = req.body || {};
  const subscription = plan ? { plan, price: String(price || '0'), state: state || 'active' } : null;
  setSession(res, { email, subscription });
  res.json({ ok: true, email, subscription });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`[mock-app] Listening on http://localhost:${PORT}`));
