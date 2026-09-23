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
  const collections = ['gatepasses', 'staffNotifications', 'deliveries', 'salesOrders', 'stockInwardOrders', 'stockBalances', 'stockMovements', 'users', 'importShipments'];
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

const TRACKTAINER_API_KEY = process.env.TRACKTAINER_API_KEY || 'ca0853e15f63f20e1f02bc87166ed103bdeab9db';
const TRACKTAINER_BASE_URL = 'https://api.tracktainer.com/v1';

// -------------------------------------------------------------
// TRACKTAINER HELPER FUNCTIONS
// -------------------------------------------------------------
function mapTracktainerData(trackItem) {
  const attr = trackItem.attributes || {};
  const container = (attr.containers && attr.containers[0]) ? attr.containers[0] : null;
  const latestMov = container ? container.latest_movement : null;
  
  return {
    tracktainerId: trackItem.id,
    containerNumber: attr.shipment_number,
    shipmentStatus: attr.shipment_status || 'IN_TRANSIT',
    carrierName: (attr.carrier && attr.carrier.name) ? attr.carrier.name : 'Ocean Carrier',
    carrierScac: (attr.carrier && attr.carrier.scac) ? attr.carrier.scac : '',
    originPort: attr.port_of_loading ? `${attr.port_of_loading.name}` : (attr.origin ? attr.origin.name : 'Qingdao'),
    destinationPort: attr.port_of_discharge ? `${attr.port_of_discharge.name}` : (attr.destination ? attr.destination.name : 'Karachi'),
    polCode: attr.port_of_loading ? attr.port_of_loading.code : (attr.origin ? attr.origin.code : 'CNTAO'),
    podCode: attr.port_of_discharge ? attr.port_of_discharge.code : (attr.destination ? attr.destination.code : 'PKKHI'),
    originCountry: attr.port_of_loading?.country?.name || attr.origin?.country?.name || 'China',
    destinationCountry: attr.port_of_discharge?.country?.name || attr.destination?.country?.name || 'Pakistan',
    etd: attr.etd || '2026-08-31',
    eta: attr.eta || '2026-10-03',
    delayDays: typeof attr.delay_days === 'number' ? attr.delay_days : 0,
    transitTime: attr.transit_time || 33,
    transshipmentCount: attr.transshipment_count || 0,
    containerCount: attr.container_count || 1,
    co2: attr.co2 || 0.93,
    currentLocation: latestMov && latestMov.location ? `${latestMov.location.name}, ${latestMov.location.country ? latestMov.location.country.name : ''}` : 'Departed Qingdao, China',
    vesselName: latestMov && latestMov.vessel ? latestMov.vessel.name : 'KMTC CHENNAI',
    vesselImo: latestMov && latestMov.vessel ? latestMov.vessel.imo : '9375513',
    voyage: latestMov ? latestMov.voyage : '2605W',
    lastCheckedAt: attr.last_checked_at || new Date().toISOString(),
    containers: attr.containers || [],
    movements: container ? container.movements : []
  };
}

async function syncWithTracktainer(specificContainerNumber) {
  if (!TRACKTAINER_API_KEY) return { success: false, error: 'No API key' };
  try {
    const res = await fetch(`${TRACKTAINER_BASE_URL}/ocean/shipments`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TRACKTAINER_API_KEY}`,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[Tracktainer] Fetch failed:', res.status, errText);
      return { success: false, status: res.status, error: errText };
    }

    const json = await res.json();
    const items = json.data || [];
    console.log(`[Tracktainer] Retrieved ${items.length} shipment(s) from Tracktainer API`);

    if (!serverDb) serverDb = {};
    if (!Array.isArray(serverDb.importShipments)) serverDb.importShipments = [];

    items.forEach(item => {
      const mapped = mapTracktainerData(item);
      const idx = serverDb.importShipments.findIndex(s => 
        (s.containerNumber && s.containerNumber.includes(mapped.containerNumber)) ||
        s.tracktainerId === mapped.tracktainerId
      );

      if (idx !== -1) {
        // Merge with existing shipment, updating tracking telemetry
        const existingStatus = serverDb.importShipments[idx].status;
        const isVoidedOrCancelled = existingStatus === 'Cancelled' || existingStatus === 'Voided';
        serverDb.importShipments[idx] = {
          ...serverDb.importShipments[idx],
          ...mapped,
          status: isVoidedOrCancelled ? existingStatus : (mapped.shipmentStatus === 'ARRIVED' ? 'Arrived' : (existingStatus || 'Shipped')),
          updatedAt: new Date().toISOString()
        };
      } else {
        // Create new import shipment record
        const nextNum = `IMP-${String(serverDb.importShipments.length + 1).padStart(5, '0')}`;
        serverDb.importShipments.push({
          id: `imp-${mapped.containerNumber.toLowerCase()}`,
          shipmentNumber: nextNum,
          supplierPartyId: 'pty-4', // Qingdao Jinhe Poultry Machinery Co.
          shippingTerm: 'FOB',
          blNumber: `BL-${mapped.containerNumber}`,
          carrierName: mapped.carrierName,
          status: mapped.shipmentStatus === 'ARRIVED' ? 'Arrived' : 'Shipped',
          expenses: [
            { name: 'Ocean Freight (40HQ Container)', amountPkr: 720000, isLandedCostEligible: true },
            { name: 'Customs Duty & Port Taxes', amountPkr: 380000, isLandedCostEligible: true },
            { name: 'Terminal Handling Charges (Karachi QICT)', amountPkr: 95000, isLandedCostEligible: true },
            { name: 'Inland Transport to Warehouse (Multan Rd)', amountPkr: 160000, isLandedCostEligible: true }
          ],
          allocationMethod: 'Value',
          ...mapped,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    });

    serverVersion++;
    lastUpdatedAt = Date.now();
    persistDbToFile();
    notifyPollClients();

    return { success: true, count: items.length, shipments: serverDb.importShipments };
  } catch (err) {
    console.error('[Tracktainer] Sync exception:', err);
    return { success: false, error: err.message };
  }
}

// Initial sync on startup
setTimeout(() => {
  syncWithTracktainer().then(res => {
    if (res.success) {
      console.log(`[Tracktainer] Initial startup sync successful: ${res.count} shipment(s) synced.`);
    }
  });
}, 2000);

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
  // API ROUTE: GET /api/tracking/shipments (Live Tracktainer data)
  // -------------------------------------------------------------
  if (pathname === '/api/tracking/shipments' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const allShipments = (serverDb && serverDb.importShipments) ? serverDb.importShipments : [];
    const activeShipments = allShipments.filter(s => s && s.status !== 'Cancelled' && s.status !== 'Voided');
    res.end(JSON.stringify({
      success: true,
      count: activeShipments.length,
      shipments: activeShipments
    }));
    return;
  }

  // -------------------------------------------------------------
  // API ROUTE: POST /api/tracking/sync (Force Live Sync with Tracktainer)
  // -------------------------------------------------------------
  if (pathname === '/api/tracking/sync' && req.method === 'POST') {
    syncWithTracktainer().then(result => {
      res.writeHead(result.success ? 200 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // -------------------------------------------------------------
  // API ROUTE: POST /api/tracking/register (Register New Container in Tracktainer)
  // -------------------------------------------------------------
  if (pathname === '/api/tracking/register' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const containerNumber = (payload.containerNumber || '').trim();
        const blNumber = (payload.blNumber || '').trim();
        const numberToTrack = containerNumber || blNumber;

        if (!numberToTrack) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing containerNumber or blNumber' }));
          return;
        }

        console.log(`[Tracktainer] Registering shipment with Tracktainer API: ${numberToTrack}`);
        const response = await fetch(`${TRACKTAINER_BASE_URL}/ocean/shipments`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TRACKTAINER_API_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            data: {
              type: 'ocean-shipments',
              attributes: {
                shipment_number: numberToTrack,
                shipment_number_type: containerNumber ? 'CONTAINER' : 'BILL_OF_LADING'
              }
            }
          })
        });

        const data = await response.json();
        if (!response.ok) {
          console.warn('[Tracktainer] Registration warning/error from API:', data);
        }

        // Trigger background sync to pull the newly registered or existing shipment
        setTimeout(() => syncWithTracktainer(), 1000);

        res.writeHead(response.ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: response.ok,
          tracktainerResponse: data
        }));
      } catch (err) {
        console.error('[Tracktainer] Registration error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // -------------------------------------------------------------
  // API ROUTE: POST /api/tracking/webhook (Webhook Receiver from Tracktainer)
  // -------------------------------------------------------------
  if (pathname === '/api/tracking/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        console.log('[Tracktainer Webhook] Received webhook notification:', payload.event || payload.type);
        // Refresh Tracktainer data
        syncWithTracktainer();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Malformed webhook payload' }));
      }
    });
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
