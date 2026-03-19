const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

function sbHeaders() {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };
}

async function dbFind(email) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(email)}&select=email`,
    { headers: sbHeaders() }
  );
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function dbInsert(email, business_type, plan) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify({ email, business_type, plan })
  });
  return res.ok;
}

async function dbCount() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads?select=id`, {
    headers: { ...sbHeaders(), 'Prefer': 'count=exact' }
  });
  const range = res.headers.get('content-range');
  return parseInt(range?.split('/')[1] || '0');
}

async function dbAll() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?select=*&order=created_at.desc`,
    { headers: sbHeaders() }
  );
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function dbInsertCustomer(email, plan, stripeCustomerId, stripeSubId) {
  await fetch(`${SUPABASE_URL}/rest/v1/customers`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      email,
      plan,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubId,
      status: 'active'
    })
  }).catch(err => console.error('dbInsertCustomer error:', err.message));
}

async function dbAllCustomers() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/customers?select=*&order=created_at.desc`,
    { headers: sbHeaders() }
  );
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function sendSignupEmail(email, biz, plan) {
  if (!process.env.RESEND_API_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'BRUMA AI <onboarding@resend.dev>',
      to: process.env.NOTIFY_EMAIL || 'estebanmontielw@gmail.com',
      subject: `🌫 Nuevo lead: ${email}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#08090d;color:#f0f0f0;border-radius:12px">
          <h2 style="color:#22c55e;margin-bottom:16px">🌫 Nuevo lead en BRUMA AI</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#6b7280;font-size:14px">Email</td><td style="padding:8px 0;font-size:14px"><strong>${email}</strong></td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;font-size:14px">Negocio</td><td style="padding:8px 0;font-size:14px">${biz || '—'}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7280;font-size:14px">Plan</td><td style="padding:8px 0;font-size:14px">${plan}</td></tr>
          </table>
          <a href="https://bruma-ai.onrender.com/admin" style="display:inline-block;margin-top:20px;background:#22c55e;color:#000;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Ver panel admin →</a>
        </div>
      `,
    }),
  }).catch(err => console.error('Resend error:', err.message));
}

async function createStripeSession(plan, email) {
  const prices = {
    Starter: process.env.STRIPE_PRICE_STARTER,
    Growth: process.env.STRIPE_PRICE_GROWTH,
    Agency: process.env.STRIPE_PRICE_AGENCY,
  };
  const priceId = prices[plan];
  if (!priceId) throw new Error('Plan inválido o precio no configurado');

  const base = process.env.APP_URL || 'https://bruma-ai.onrender.com';
  const params = new URLSearchParams({
    mode: 'subscription',
    'payment_method_types[0]': 'card',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'metadata[plan]': plan,
    success_url: `${base}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/#pricing`,
  });
  if (email) params.set('customer_email', email);

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  return res.json();
}

function verifyStripeSignature(rawBody, sig, secret) {
  const parts = sig.split(',');
  const tPart = parts.find(p => p.startsWith('t='));
  if (!tPart) return false;
  const t = tPart.slice(2);
  const v1s = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  const payload = `${t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return v1s.some(s => {
    try { return crypto.timingSafeEqual(Buffer.from(s, 'hex'), Buffer.from(expected, 'hex')); }
    catch { return false; }
  });
}

app.use(cors());

// Stripe webhook — needs raw body, must be BEFORE express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(400).json({ error: 'Webhook secret not configured' });

  if (!verifyStripeSignature(req.body.toString(), sig, secret)) {
    return res.status(400).send('Invalid signature');
  }

  let event;
  try { event = JSON.parse(req.body.toString()); }
  catch { return res.status(400).send('Invalid JSON'); }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email || session.customer_email;
    const plan = session.metadata?.plan || 'Growth';
    await dbInsertCustomer(email, plan, session.customer, session.subscription);
    console.log(`New customer: ${email} — ${plan}`);
  }

  res.json({ received: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="BRUMA Admin"');
    return res.status(401).send('Acceso requerido');
  }
  const [user, ...rest] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  const pass = rest.join(':');
  if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASS) {
    return next();
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="BRUMA Admin"');
  return res.status(401).send('Credenciales inválidas');
}

app.post('/api/waitlist', async (req, res) => {
  try {
    const { email, business_type, plan } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Email válido requerido.' });
    }

    const exists = await dbFind(email.toLowerCase());
    if (exists) {
      return res.status(409).json({ error: '¡Este email ya está en la lista de espera!' });
    }

    const ok = await dbInsert(email.toLowerCase(), business_type || '', plan || 'Growth');
    if (!ok) {
      return res.status(500).json({ error: 'Error al guardar. Intenta de nuevo.' });
    }

    sendSignupEmail(email, business_type, plan || 'Growth');

    const count = await dbCount();
    res.json({ success: true, count: count + 45 });
  } catch (err) {
    console.error('POST /api/waitlist error:', err.message);
    res.status(500).json({ error: 'Error interno.' });
  }
});

app.get('/api/waitlist/count', async (req, res) => {
  try {
    const count = await dbCount();
    res.json({ count: count + 45 });
  } catch {
    res.json({ count: 47 });
  }
});

app.post('/api/checkout', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({ error: 'Pagos no configurados aún.' });
    }
    const { plan, email } = req.body;
    if (!['Starter', 'Growth', 'Agency'].includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido.' });
    }
    const session = await createStripeSession(plan, email);
    if (!session.url) {
      console.error('Stripe session error:', JSON.stringify(session));
      return res.status(500).json({ error: 'Error creando sesión de pago.' });
    }
    res.json({ url: session.url });
  } catch (err) {
    console.error('POST /api/checkout error:', err.message);
    res.status(500).json({ error: 'Error interno.' });
  }
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const [leads, customers] = await Promise.all([dbAll(), dbAllCustomers()]);
    const byPlan = (arr, plan) => arr.filter(l => l.plan === plan).length;
    const mrr = customers.reduce((acc, c) => acc + ({ Starter: 39, Growth: 79, Agency: 179 }[c.plan] || 0), 0);

    const leadRows = leads.map((l, i) => {
      const date = new Date(l.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<tr><td>${i + 1}</td><td>${escapeHtml(l.email)}</td><td>${escapeHtml(l.business_type || '—')}</td><td><span class="plan plan-${escapeHtml(l.plan)}">${escapeHtml(l.plan)}</span></td><td>${date}</td></tr>`;
    }).join('');

    const customerRows = customers.map((c, i) => {
      const date = new Date(c.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<tr><td>${i + 1}</td><td>${escapeHtml(c.email)}</td><td><span class="plan plan-${escapeHtml(c.plan)}">${escapeHtml(c.plan)}</span></td><td><span class="status-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span></td><td>${date}</td></tr>`;
    }).join('');

    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BRUMA AI — Admin</title>
  <style>
    :root { --bg:#08090d; --bg2:#0f1117; --border:rgba(255,255,255,0.08); --text:#f0f0f0; --muted:#6b7280; --green:#22c55e; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:system-ui,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; padding:2rem; }
    header { display:flex; align-items:center; justify-content:space-between; margin-bottom:2rem; padding-bottom:1.5rem; border-bottom:1px solid var(--border); }
    header h1 { font-size:1.3rem; font-weight:700; }
    .tag { font-size:0.75rem; background:rgba(34,197,94,0.12); color:var(--green); border:1px solid rgba(34,197,94,0.25); padding:3px 10px; border-radius:20px; }
    .stats { display:flex; gap:1rem; margin-bottom:2rem; flex-wrap:wrap; }
    .stat { background:var(--bg2); border:1px solid var(--border); border-radius:12px; padding:1.25rem 1.5rem; min-width:130px; }
    .stat .number { font-size:2.2rem; font-weight:800; color:var(--green); line-height:1; }
    .stat .number.mrr { color:#a78bfa; }
    .stat .label { font-size:0.72rem; color:var(--muted); margin-top:5px; text-transform:uppercase; letter-spacing:0.07em; }
    .section-title { font-size:1rem; font-weight:700; margin:2rem 0 0.75rem; display:flex; align-items:center; justify-content:space-between; }
    .btn { background:var(--green); color:#000; border:none; padding:0.5rem 1.25rem; border-radius:7px; cursor:pointer; font-weight:700; font-size:0.85rem; }
    .table-wrap { overflow-x:auto; border:1px solid var(--border); border-radius:12px; margin-bottom:2rem; }
    table { width:100%; border-collapse:collapse; }
    th { text-align:left; padding:0.75rem 1rem; background:var(--bg2); border-bottom:1px solid var(--border); font-size:0.72rem; color:var(--muted); text-transform:uppercase; letter-spacing:0.07em; white-space:nowrap; }
    td { padding:0.8rem 1rem; border-bottom:1px solid var(--border); font-size:0.875rem; }
    tr:last-child td { border-bottom:none; }
    tr:hover td { background:var(--bg2); }
    .plan { display:inline-block; padding:2px 10px; border-radius:20px; font-size:0.72rem; font-weight:700; }
    .plan-Growth { background:rgba(34,197,94,0.15); color:#22c55e; border:1px solid rgba(34,197,94,0.25); }
    .plan-Starter { background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.25); }
    .plan-Agency { background:rgba(168,85,247,0.15); color:#c084fc; border:1px solid rgba(168,85,247,0.25); }
    .status-active { color:#22c55e; font-weight:600; }
    .status-inactive, .status-cancelled { color:#f87171; }
    .empty { text-align:center; padding:2rem; color:var(--muted); }
  </style>
</head>
<body>
  <header>
    <h1>🌫 BRUMA AI <span style="color:var(--muted);font-weight:400;font-size:1rem"> / Admin</span></h1>
    <span class="tag">● Live</span>
  </header>

  <div class="stats">
    <div class="stat"><div class="number">${leads.length}</div><div class="label">Total leads</div></div>
    <div class="stat"><div class="number">${customers.length}</div><div class="label">Clientes pagos</div></div>
    <div class="stat"><div class="number mrr">$${mrr}</div><div class="label">MRR actual</div></div>
    <div class="stat"><div class="number">${byPlan(leads, 'Growth')}</div><div class="label">Leads Growth</div></div>
    <div class="stat"><div class="number">${byPlan(leads, 'Starter')}</div><div class="label">Leads Starter</div></div>
    <div class="stat"><div class="number">${byPlan(leads, 'Agency')}</div><div class="label">Leads Agency</div></div>
  </div>

  <div class="section-title">💳 Clientes pagos</div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>#</th><th>Email</th><th>Plan</th><th>Estado</th><th>Fecha de pago</th></tr></thead>
      <tbody>${customerRows || '<tr><td colspan="5" class="empty">Sin clientes pagos aún. Configura Stripe para empezar a cobrar.</td></tr>'}</tbody>
    </table>
  </div>

  <div class="section-title">
    📋 Waitlist
    <button class="btn" onclick="exportCSV()">⬇ Exportar CSV</button>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>#</th><th>Email</th><th>Tipo de negocio</th><th>Plan</th><th>Fecha</th></tr></thead>
      <tbody>${leadRows || '<tr><td colspan="5" class="empty">Aún no hay leads.</td></tr>'}</tbody>
    </table>
  </div>

  <script>
    function exportCSV() {
      const data = ${JSON.stringify(leads)};
      const header = 'Email,Tipo de negocio,Plan,Fecha';
      const rows = data.map(l => [l.email, '"' + (l.business_type || '').replace(/"/g, '""') + '"', l.plan, l.created_at].join(','));
      const csv = [header, ...rows].join('\\n');
      const a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      a.download = 'bruma-waitlist-' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
    }
  </script>
</body>
</html>`);
  } catch (err) {
    console.error('GET /admin error:', err.message);
    res.status(500).send('Error al cargar el panel: ' + err.message);
  }
});

app.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('BRUMA AI running on port ' + PORT);
  console.log('Supabase URL set:', !!SUPABASE_URL);
  console.log('Supabase KEY set:', !!SUPABASE_KEY);
  console.log('Stripe configured:', !!process.env.STRIPE_SECRET_KEY);
  console.log('Resend configured:', !!process.env.RESEND_API_KEY);
});
