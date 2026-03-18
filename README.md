# 🌫 BRUMA AI — Waitlist Landing Page

AI-powered social response agent. Waitlist site with real email capture backend.

---

## 🚀 Run it locally in 3 steps

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Open your browser
# Go to: http://localhost:3000
```

---

## 📋 View your leads

Once people sign up, see all your waitlist emails at:

```
http://localhost:3000/api/admin/leads
```

This returns a JSON list of everyone who signed up, their business type, and timestamp.

---

## 📁 Project structure

```
bruma-ai/
├── server.js          ← Express backend + SQLite email capture
├── package.json       ← Dependencies
├── waitlist.db        ← Auto-created database (your leads live here)
└── public/
    └── index.html     ← Full landing page with AI demo
```

---

## ☁️ Deploy to the web (free)

### Option A — Railway (easiest, recommended)
1. Go to https://railway.app
2. Connect your GitHub account
3. Upload this folder as a new repo
4. Click "Deploy" — it's live in 2 minutes
5. You get a public URL like `bruma-ai.railway.app`

### Option B — Render
1. Go to https://render.com
2. New Web Service → connect your repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Free tier available

### Option C — Vercel (frontend) + PlanetScale (DB)
More complex but more scalable for production.

---

## 🔒 Before going public

1. **Protect the admin route** — add a password to `/api/admin/leads`
2. **Add email sending** — use Resend.com or Mailgun to send confirmation emails
3. **Custom domain** — point your domain to Railway/Render

---

## 💡 Next steps after validating

Once you have 50+ signups:
1. Build the client dashboard (where clients manage their response queue)
2. Add Stripe billing
3. Connect platform APIs (Meta, Google, TikTok) to receive real messages

---

Built with: Node.js · Express · SQLite · Anthropic API
