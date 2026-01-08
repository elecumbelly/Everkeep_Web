# EverKeep Web (Prototype)

This is a static PWA prototype for EverKeep based on the PRD. It stores data locally in your browser (localStorage and IndexedDB) and supports offline use.

## Run locally

- `python3 -m http.server 5173`
- Open `http://localhost:5173`

## Notes

- Data stays on device. Export is a JSON bundle with metadata.
- Media (photos and audio) live in IndexedDB on the same device.
- The service worker caches the app shell for offline access.

## Optional PHP + MySQL backup

If you have PHP available on the Hostinger subdomain, you can enable a simple cloud backup:

1) Create the table from `api/schema.sql` in your MySQL database.
2) Place the `api/` folder in your web root.
3) Store `.env` one level above the web root (or set env vars) so it is not public.
4) Keep `.htaccess` in the web root to block `.env`/`.sql` from being served.
4) Toggle **Cloud backup** in the app Settings.

The API stores a JSON backup per device (local-first). Media files remain on the device.
If you need a custom API URL, set `window.EVERKEEP_API_BASE` before `app.js`.

Environment variables (server-side):
- `ALLOWED_ORIGINS`: comma-separated list of allowed web origins.
- `MAX_BODY_BYTES`: max JSON payload size (default 5242880).
- `RATE_LIMIT_REQUESTS`: requests allowed per window (default 120).
- `RATE_LIMIT_WINDOW`: window length in seconds (default 300).

## Project files

- `index.html`
- `styles.css`
- `app.js`
- `sw.js`
- `manifest.webmanifest`
- `api/` (optional backend)
