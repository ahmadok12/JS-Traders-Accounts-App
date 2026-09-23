/**
 * JS Traders ERP - Real-Time Synchronization & Static Web Server
 * Runs on port 8080.
 * Features:
 * - Full static file serving (HTML, JS, CSS, images) with CORS & MIME detection
 * - Cross-device JSON synchronization (/api/sync) for PC <-> Phone instant sync
 * - Sub-second long-polling (/api/sync/poll) for instant push alerts across devices
 * - Persistent storage backup in data/db.json
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// MIME types dictionary
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
};

// In-memory state with persistence
let serverVersion = 1;
let lastUpdatedAt = Date.now();
let serverDb = null;
const waitingPollClients = [];

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error('Failed to create data directory:', e);
  }
}

// Load initial database from file if it exists
if (fs.existsSync(DB_FILE)) {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    serverDb = parsed.db || parsed;
    serverVersion = parsed.version || 1;
    lastUpdatedAt = parsed.updatedAt || Date.now();
    console.log(`[SyncServer] Loaded existing database from ${DB_FILE} (v${serverVersion})`);
  } catch (e) {
    console.warn('[SyncServer] Error loading db.json, starting fresh:', e);
  }
}

function persistDbToFile() {
  try {
    const payload = JSON.stringify({
      version: serverVersion,
      updatedAt: lastUpdatedAt,
      db: serverDb
    });
    fs.writeFile(DB_FILE, payload, 'utf8', (err) => {
      if (err) console.error('[SyncServer] Error persisting db.json:', err);
    });
  } catch (e) {
    console.error('[SyncServer] Persistence exception:', e);
  }
}

function smartMergeDb(base, incoming) {
  if (!base) return incoming;
  if (!incoming) return base;

  const merged = { ...base, ...incoming };

  // Collections to smart-merge by item id
  const collections = ['gatepasses', 'staffNotifications', 'deliveries', 'salesOrders', 'stockBalances', 'stockMovements', 'users'];
  for (const col of collections) {
    const arrBase = Array.isArray(base[col]) ? base[col] : [];
    const arrInc = Array.isArray(incoming[col]) ? incoming[col] : [];

    const getItemKey = (item) => {
      if (!item) return null;
      if (item.id) return item.id;
      if (item.warehouseId && item.variantId) {
        item.id = `bal-${item.warehouseId}-${item.variantId}`;
        return item.id;
      }
      return null;
    };

    const map = new Map();
    // Put base items in map
    arrBase.forEach(item => {
      const key = getItemKey(item);
      if (key) map.set(key, item);
    });

    // Merge or add incoming items
    arrInc.forEach(item => {
      const key = getItemKey(item);
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, item);
      } else {
        const existing = map.get(key);
        const existingProofs = (existing.staffProofs || []).length;
        const incProofs = (item.staffProofs || []).length;

        // If incoming has more proof photos or newer status, prioritize incoming
        if (incProofs > existingProofs) {
          map.set(key, { ...existing, ...item });
        } else if (item.updatedAt && (!existing.updatedAt || new Date(item.updatedAt) >= new Date(existing.updatedAt))) {
          map.set(key, { ...existing, ...item });
        } else {
          map.set(key, { ...item, ...existing });
        }
      }
    });

    merged[col] = Array.from(map.values());
  }

  return merged;
}

function notifyPollClients() {
  const count = waitingPollClients.length;
  while (waitingPollClients.length > 0) {
    const client = waitingPollClients.shift();
    try {
      client.res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      client.res.end(JSON.stringify({
        changed: true,
        version: serverVersion,
        updatedAt: lastUpdatedAt,
        db: serverDb
      }));
    } catch (e) {}
  }
  if (count > 0) {
    console.log(`[SyncServer] Dispatched push update v${serverVersion} to ${count} connected device(s)`);
  }
}

const server = http.createServer((req, res) => {
  // Global CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // -------------------------------------------------------------
  // API ROUTE: Health check
  // -------------------------------------------------------------
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: serverVersion, clientsWaiting: waitingPollClients.length, time: new Date().toISOString() }));
    return;
  }

  // -------------------------------------------------------------
  // API ROUTE: GET /api/sync (Fetch full state)
  // -------------------------------------------------------------
  if (pathname === '/api/sync' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      version: serverVersion,
      updatedAt: lastUpdatedAt,
      db: serverDb
    }));
    return;
  }

  // -------------------------------------------------------------
  // API ROUTE: POST /api/sync (Update state from PC or Phone)
  // -------------------------------------------------------------
  if (pathname === '/api/sync' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      // Safety limit: 50MB
      if (body.length > 50 * 1024 * 1024) {
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (payload && payload.db) {
          // Smart-merge with existing server state instead of wiping
          serverDb = smartMergeDb(serverDb, payload.db);
          serverVersion++;
          lastUpdatedAt = Date.now();
          persistDbToFile();
          notifyPollClients();

          console.log(`[SyncServer] Synced DB v${serverVersion} (Gatepasses: ${serverDb.gatepasses?.length || 0})`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            version: serverVersion,
            updatedAt: lastUpdatedAt,
            gatepassCount: serverDb.gatepasses?.length || 0
          }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid payload: missing db property' }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Malformed JSON', details: err.message }));
      }
    });
    return;
  }

  // -------------------------------------------------------------
  // API ROUTE: GET /api/sync/poll (Long-polling endpoint)
  // -------------------------------------------------------------
  if (pathname === '/api/sync/poll' && req.method === 'GET') {
    const clientVersion = parseInt(parsedUrl.searchParams.get('since') || '0', 10);

    // If server has a newer version, reply immediately
    if (serverVersion > clientVersion && serverDb) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        changed: true,
        version: serverVersion,
        updatedAt: lastUpdatedAt,
        db: serverDb
      }));
      return;
    }

    // Otherwise, hold connection for up to 8 seconds
    const clientRef = { res };
    waitingPollClients.push(clientRef);

    const timeout = setTimeout(() => {
      const idx = waitingPollClients.indexOf(clientRef);
      if (idx !== -1) {
        waitingPollClients.splice(idx, 1);
        try {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            changed: false,
            version: serverVersion
          }));
        } catch (e) {}
      }
    }, 8000);

    req.on('close', () => {
      clearTimeout(timeout);
      const idx = waitingPollClients.indexOf(clientRef);
      if (idx !== -1) waitingPollClients.splice(idx, 1);
    });

    return;
  }

  // -------------------------------------------------------------
  // STATIC FILE SERVING
  // -------------------------------------------------------------
  let safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') safePath = '/index.html';

  const filePath = path.join(__dirname, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[SyncServer] Real-time ERP server running on http://0.0.0.0:${PORT}`);
  console.log(`[SyncServer] Mobile access: http://192.168.1.13:${PORT}/mobile.html`);
  console.log(`[SyncServer] Reports access: http://192.168.1.13:${PORT}/mobile-reports.html`);
});
