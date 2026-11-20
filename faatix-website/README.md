# Faatix website

The public marketing website, kept apart from the business app (`../client`).

- `npm install` then `npm run dev` → http://localhost:5174 (needs the API on :5000 for the contact form).
- `npm run build` → static files in `dist/`, ready for any static host (Netlify, Vercel, Railway static, Nginx …).

Configuration (`.env`, see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | The Faatix API, e.g. `https://app.faatix.com`. The contact / demo form posts to `/api/contact`. |
| `VITE_APP_URL` | The business app; "Sign in" opens `<VITE_APP_URL>/signin`. |

On the API side set `WEBSITE_ORIGIN` (e.g. `https://faatix.com,https://www.faatix.com`) so the browser allows the form.

Self sign-up is closed: businesses are registered by Faatix in the super admin area. "Request a demo" sends a message
that appears in Super admin → Support → Website messages.

`static-version/` is the older plain-HTML website, kept for reference.
