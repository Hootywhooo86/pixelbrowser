# Pixelbrowser sync server

Stores encrypted sync blobs. It never sees sync codes, keys or plaintext. It has no dependencies.

```bash
PORT=8787 DATA_DIR=./data npm start
```

Put it behind HTTPS (Caddy, nginx, Fly.io, Render) before phones use it. Then enter its address
under Settings → Sync on each device.
