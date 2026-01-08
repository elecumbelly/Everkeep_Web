Next session plan (auth scaffolding)

1) Preflight
- Run `npm install` and `npm test`.
- Hard reload the PWA once to refresh the service worker cache.

2) Backend
- Add auth schema migration for `users`, `sessions`, `devices`.
- Create `api/auth.php` with `register`, `login`, `logout`, `me`.
- Use `password_hash` + HttpOnly session cookie.
- Add rate limiting + basic input validation.

3) Frontend
- Add a Sign in / Create account modal in Me.
- Show account status.
- Wire fetches to include credentials.
- Keep "Sync now" explicit.

4) API wiring
- Make backup/sync aware of auth.
- Keep ownerKey path for local-only until user signs in.

5) Docs
- Update `README.md` with auth setup + new env vars.

Assumptions for this phase
- Cookie-based sessions.
- No email verification yet.
- "Sync now" only.
