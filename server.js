const express = require('express');
const cors = require('cors');
const path = require('path');

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
  return rows.length > 0;
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

app.use(cors());
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
  } catch (err) {
    res.json({ count: 47 });
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
    const leads = await dbAll();
    const byPlan = (plan) => leads.filter(l => l.plan === plan).length;

    const rows = leads.map((l, i) => {
      const date = new Date(l.created_at).toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
      return `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(l.email)}</td>
          <td>${escapeHtml(l.business_type || '—')}</td>
          <td><span class="plan plan-${escapeHtml(l.plan)}">${escapeHtml(l.plan)}</span></td>
          <td>${date}</td>
        </tr>`;
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
    .stat .label { font-size:0.72rem; color:var(--muted); margin-top:5px; text-transform:uppercase; letter-spacing:0.07em; }
    .toolbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; }
    .toolbar p { font-size:0.875rem; color:var(--muted); }
    .btn { background:var(--green); color:#000; border:none; padding:0.5rem 1.25rem; border-radius:7px; cursor:pointer; font-weight:700; font-size:0.85rem; }
    .btn:hover { opacity:0.88; }
    .table-wrap { overflow-x:auto; border:1px solid var(--border); border-radius:12px; }
    table { width:100%; border-collapse:collapse; }
    th { text-align:left; padding:0.75rem 1rem; background:var(--bg2); border-bottom:1px solid var(--border); font-size:0.72rem; color:var(--muted); text-transform:uppercase; letter-spacing:0.07em; white-space:nowrap; }
    td { padding:0.8rem 1rem; border-bottom:1px solid var(--border); font-size:0.875rem; }
    tr:last-child td { border-bottom:none; }
    tr:hover td { background:var(--bg2); }
    .plan { display:inline-block; padding:2px 10px; border-radius:20px; font-size:0.72rem; font-weight:700; }
    .plan-Growth { background:rgba(34,197,94,0.15); color:#22c55e; border:1px solid rgba(34,197,94,0.25); }
    .plan-Starter { background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.25); }
    .plan-Agency { background:rgba(168,85,247,0.15); color:#c084fc; border:1px solid rgba(168,85,247,0.25); }
    .empty { text-align:center; padding:3rem; color:var(--muted); }
  </style>
</head>
<body>
  <header>
    <h1>🌫 BRUMA AI <span style="color:var(--muted);font-weight:400;font-size:1rem"> / Admin</span></h1>
    <span class="tag">● Live</span>
  </header>
  <div class="stats">
    <div class="stat"><div class="number">${leads.length}</div><div class="label">Total leads</div></div>
    <div class="stat"><div class="number">${byPlan('Growth')}</div><div class="label">Growth · $79</div></div>
    <div class="stat"><div class="number">${byPlan('Starter')}</div><div class="label">Starter · $39</div></div>
    <div class="stat"><div class="number">${byPlan('Agency')}</div><div class="label">Agency · $179</div></div>
  </div>
  <div class="toolbar">
    <p>${leads.length} lead${leads.length !== 1 ? 's' : ''} registrado${leads.length !== 1 ? 's' : ''}</p>
    <button class="btn" onclick="exportCSV()">⬇ Exportar CSV</button>
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>#</th><th>Email</th><th>Tipo de negocio</th><th>Plan</th><th>Fecha</th></tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="5" class="empty">Aún no hay leads registrados.</td></tr>'}
      </tbody>
    </table>
  </div>
  <script>
    function exportCSV() {
      const data = ${JSON.stringify(leads)};
      const header = 'Email,Tipo de negocio,Plan,Fecha';
      const rows = data.map(l => [l.email, '"' + (l.business_type||'').replace(/"/g,'""') + '"', l.plan, l.created_at].join(','));
      const csv = [header, ...rows].join('\\n');
      const a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      a.download = 'bruma-waitlist-' + new Date().toISOString().slice(0,10) + '.csv';
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('BRUMA AI running on port ' + PORT);
});
