# T's Services — Panel (panel.tservices.cc)

A standalone admin / reseller / token panel, hosted separately from the public
site at **panel.tservices.cc**. It is a static GitHub Pages site (like the main
one) and talks to the **same** Better Auth + token backend on Vercel.

Everything is role-gated by what the backend reports for the signed-in account:

| Role       | Sees                                                                 |
|------------|----------------------------------------------------------------------|
| any user   | **My tokens** — attach a token key to their account, view their tokens |
| reseller   | + **Mint** tokens (credit-based) and manage their own tokens          |
| admin      | + **tester** tokens, assign to email, manage resellers & credits, all tokens |

The tokens minted here are the real license keys the Yaoki menu checks in-game
(via `POST /api/validate`), so this panel is the source of truth for access.

---

## One-time setup

### 1. Database migration (Neon)
In the Neon SQL editor of the same database the backend already uses, run
**`server/migrate-tokens.sql`** (in the main `tservices` repo). It adds `role`
+ `credits` to `user` and creates the `tokens` table.

### 2. Backend env vars (Vercel → the `tservices-server` project)
Add / update:

```
ALLOWED_ORIGINS=https://tservices.cc,https://panel.tservices.cc
ADMIN_EMAILS=you@example.com          # you (and any co-admins), comma-separated
```

Keep the existing `DATABASE_URL`, `BETTER_AUTH_*`, `SITE_URL`, `RESEND_*`,
`STRIPE_*`. Then **redeploy** the backend so the new `/api/*` routes and the
multi-origin CORS take effect.

> `ADMIN_EMAILS` makes those addresses admin automatically — no DB editing.
> After that, promote resellers from the panel's Admin → “resellers & roles”.

### 3. Publish this panel to GitHub Pages
GitHub Pages allows only one custom domain per repo, and the main repo already
owns `tservices.cc`, so this needs its **own repo**:

1. Create a new repo, e.g. `tservices-panel`, and push these files to it.
2. Repo **Settings → Pages** → Source: `main` branch, `/ (root)`.
3. It will read the `CNAME` file and set the custom domain to
   `panel.tservices.cc`. Tick **Enforce HTTPS** once the cert is issued.

### 4. DNS
At your DNS provider for `tservices.cc`, add:

```
Type: CNAME   Host: panel   Value: <your-github-username>.github.io
```

(For `tommystruble1`, that's `tommystruble1.github.io`.) Give it a few minutes,
then GitHub Pages will validate `panel.tservices.cc`.

### 5. Point the game client at the backend
In the Yaoki `.lua`, `KAUTH.url` is already set to
`https://tservices-server.vercel.app/api/validate`. Re-obfuscate and
redistribute the menu so buyers' tokens are checked against the panel's DB.

---

## Notes
- Separate origin ⇒ separate login. Signing in here sends its own magic link
  that returns to `panel.tservices.cc` (the backend picks the return site from
  the request origin).
- `BACKEND_URL` lives in `assets/js/backend.js` — change it if the backend URL
  ever moves.
- `noindex` is set so the panel stays out of search results.
