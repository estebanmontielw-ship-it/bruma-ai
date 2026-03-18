const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

const DB_FILE = path.join(__dirname, 'waitlist.json');

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ leads: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

app.use(cors());
app.use(express.json());

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'Public')));

app.post('/api/waitlist', (req, res) => {
  const { email, business_type, plan } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email válido requerido.' });
  }
  const db = readDB();
  const exists = db.leads.find(l => l.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    return res.status(409).json({ error: '¡Este email ya está en la lista de espera!' });
  }
  const lead = {
    id: Date.now(),
    email,
    business_type: business_type || '',
    plan: plan || 'Growth',
    created_at: new Date().toISOString()
  };
  db.leads.push(lead);
  writeDB(db);
  res.json({ success: true, count: db.leads.length + 47 });
});

app.get('/api/waitlist/count', (req, res) => {
  const db = readDB();
  res.json({ count: db.leads.length + 47 });
});

app.get('/api/admin/leads', (req, res) => {
  const db = readDB();
  res.json(db.leads);
});

// Catch all - serve index.html
app.get('*', (req, res) => {
  const publicPath = path.join(__dirname, 'public', 'index.html');
  const PublicPath = path.join(__dirname, 'Public', 'index.html');
  if (fs.existsSync(publicPath)) {
    res.sendFile(publicPath);
  } else if (fs.existsSync(PublicPath)) {
    res.sendFile(PublicPath);
  } else {
    res.send('BRUMA AI - index.html not found');
  }
});

// Use Railway's PORT environment variable
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n✅ BRUMA AI corriendo en http://localhost:' + PORT);
  console.log('📋 Ver leads en http://localhost:' + PORT + '/api/admin/leads\n');
});
