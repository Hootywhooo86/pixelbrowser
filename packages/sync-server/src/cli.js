#!/usr/bin/env node
// Run the sync server: PORT=8787 DATA_DIR=./data npm start
// Put it behind HTTPS (Caddy, nginx, Fly.io, Render...) before using it from phones.
import { createSyncServer } from './server.js'

const port = Number(process.env.PORT) || 8787
const dataDir = process.env.DATA_DIR || new URL('../data', import.meta.url).pathname
createSyncServer({ dataDir }).listen(port, () => {
  console.log(`Bit Browser sync server on http://localhost:${port} (data in ${dataDir})`)
})
