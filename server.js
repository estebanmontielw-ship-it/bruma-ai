const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

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
  const { email, business_type, plan } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email válido requerido.' });
  }

  const { data: existing } = await supabase
    .from('leads')
    .select('email')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: '¡Este email ya está en la lista de espera!' });
  }

  const { error } = await supabase.from('leads').insert({
    email: email.toLowerCase(),
    business_type: business_type || '',
    plan: plan || 'Growth',
  });

  if (error) {
    console.error('DB error:', error);
    return res.status(500).json({ error: 'Error al guardar. Intenta de nuevo.' });
  }

  const { count } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true });

  res.json({ success: true, count: (count || 0) + 45 });
});

app.get('/api/waitlist/count', async (req, res) => {
  const { count } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true });
  res.json({ count: (count || 0) + 45 });
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

app.get('/admin', requireAdmin, async (req, res) => {
  const { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(500).send('Error al cargar leads: ' + error.message);
  }

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
    :root {
      --bg: #08090d; --bg2: #0f1117; --bg3: #141820;
      --border: rgba(255,255,255,0.08); --border2: rgba(255,255,255,0.14);
      --text: #f0f0f0; --muted: #6b7280; --muted2: #9ca3af;
      --green: #22c55e; --green-dim: rgba(34,197,94,0.12);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; padding: 2rem; }
    header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--border); }
    header h1 { font-size: 1.3rem; font-weight: 700; letter-spacing: -0.01em; }
    header .tag { font-size: 0.75rem; background: var(--green-dim); color: var(--green); border: 1px solid rgba(34,197,94,0.25); padding: 3px 10px; border-radius: 20px; }
    .stats { display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; }
    .stat { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem 1.5rem; min-width: 130px; }
    .stat .number { font-size: 2.2rem; font-weight: 800; color: var(--green); line-height: 1; }
    .stat .label { font-size: 0.72rem; color: var(--muted); margin-top: 5px; text-transform: uppercase; letter-spacing: 0.07em; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .toolbar p { font-size: 0.875rem; color: var(--muted); }
    .btn { background: var(--green); color: #000; border: none; padding: 0.5rem 1.25rem; border-radius: 7px; cursor: pointer; font-weight: 700; font-size: 0.85rem; transition: opacity 0.15s; }
    .btn:hover { opacity: 0.88; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 0.75rem 1rem; background: var(--bg2); border-bottom: 1px solid var(--border); font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.07em; white-space: nowrap; }
    td { padding: 0.8rem 1rem; border-bottom: 1px solid var(--border); font-size: 0.875rem; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--bg2); }
    .plan { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; }
    .plan-Growth { background: rgba(34,197,94,0.15); color: #22c55e; border: 1px solid rgba(34,197,94,0.25); }
    .plan-Starter { background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.25); }
    .plan-Agency { background: rgba(168,85,247,0.15); color: #c084fc; border: 1px solid rgba(168,85,247,0.25); }
    .empty { text-align: center; padding: 3rem; color: var(--muted); font-size: 0.9rem; }
  </style>
</head>
<body>
  <header>
    <h1>🌫 BRUMA AI <span style="color:var(--muted);font-weight:400;font-size:1rem"> / Admin</span></h1>
    <span class="tag">● Live</span>
  </header>

  <div class="stats">
    <div class="stat">
      <div class="number">${leads.length}</div>
      <div class="label">Total leads</div>
    </div>
    <div class="stat">
      <div class="number">${byPlan('Growth')}</div>
      <div class="label">Growth · $79</div>
    </div>
    <div class="stat">
      <div class="number">${byPlan('Starter')}</div>
      <div class="label">Starter · $39</div>
    </div>
    <div class="stat">
      <div class="number">${byPlan('Agency')}</div>
      <div class="label">Agency · $179</div>
    </div>
  </div>

  <div class="toolbar">
    <p>${leads.length} lead${leads.length !== 1 ? 's' : ''} registrado${leads.length !== 1 ? 's' : ''}</p>
    <button class="btn" onclick="exportCSV()">⬇ Exportar CSV</button>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Email</th>
          <th>Tipo de negocio</th>
          <th>Plan</th>
          <th>Fecha</th>
        </tr>
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
      const rows = data.map(l => [
        l.email,
        '"' + (l.business_type || '').replace(/"/g, '""') + '"',
        l.plan,
        l.created_at
      ].join(','));
      const csv = [header, ...rows].join('\\n');
      const a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      a.download = 'bruma-waitlist-' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
    }
  </script>
</body>
</html>`);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('BRUMA AI running on port ' + PORT);
});
