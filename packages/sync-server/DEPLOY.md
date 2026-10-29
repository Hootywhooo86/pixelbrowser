# Put the sync server online

Bit Browser's sync server stores encrypted blobs it can't read. Hosting it
somewhere public lets your phone and computer sync from anywhere. It needs
very little: about 256 MB of memory and 1 GB of disk is plenty for a family.

You need **HTTPS** (phones refuse plain `http://`). Both options below give
you HTTPS automatically.

Replace `sync.bitbrowser.example` below with your own address.

## Option A: Fly.io (cheapest, about $2–3 a month)

1. Install the Fly command line: <https://fly.io/docs/flyctl/install/> and sign up with `fly auth signup` (or `fly auth login`).
2. In `packages/sync-server/fly.toml`, change `app = "bit-browser-sync"` to a name of your own, and `primary_region` to the region closest to you (`fly platform regions` lists them).
3. From the repo root:
   ```bash
   cd packages/sync-server
   fly launch --copy-config --no-deploy      # creates the app from fly.toml
   fly volumes create bit_sync_data --size 1 # 1 GB disk for the blobs
   fly deploy
   ```
4. Check it: open `https://<your-app>.fly.dev/health`. It should show `{"ok":true}`.
5. Your own address (optional):
   ```bash
   fly certs add sync.bitbrowser.example
   ```
   Then add the DNS record Fly shows you (a CNAME to `<your-app>.fly.dev`) at your domain registrar. HTTPS is set up for you.

The server stops when nobody uses it and wakes on the next sync, so it costs very little.

## Option B: Render (about $7 a month)

Render's free plan has no disk (your synced data would be lost on every restart), so use the Starter plan.

1. Sign in at <https://render.com> with GitHub.
2. **New → Blueprint**, pick the `pixelbrowser` repository. Render reads `packages/sync-server/render.yaml` and creates the service with a 1 GB disk.
3. When it's live, open `https://<service>.onrender.com/health`. It should show `{"ok":true}`.
4. Your own address (optional): service → **Settings → Custom Domains → Add**, `sync.bitbrowser.example`, then add the CNAME record Render shows you. HTTPS is set up for you.

## Option C: your own computer or server (Docker)

```bash
docker build -t bit-sync packages/sync-server
docker run -d --restart unless-stopped -p 8787:8787 -v bit-sync-data:/data bit-sync
```

Put it behind HTTPS with Caddy (`caddy reverse-proxy --from sync.bitbrowser.example --to localhost:8787`) or nginx.

Without Docker: `PORT=8787 DATA_DIR=./data node packages/sync-server/src/cli.js`.

## Point the apps at it

On every device: **Settings → Sync → Server address**, enter `https://sync.bitbrowser.example` (or your `fly.dev` / `onrender.com` address), then create or join your sync chain as usual (QR code or the 24 words).

## Good to know

- **What the server can see:** an opaque chain ID, encrypted blobs, their sizes and when they changed. It can't see your history, tabs, bookmarks, passwords or sync code.
- **Backups:** the data is the `/data` volume. Losing it isn't a disaster: every device still has its own copy and pushes it again on the next sync.
- **Settings:** `PORT` (default 8787) and `DATA_DIR` (default `/data` in Docker).
- **Health check:** `GET /health` returns `{"ok":true}`.
