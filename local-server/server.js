const http = require('http');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const https = require('https');

const PORT = process.env.PORT || 8765;
const COGNITO_POOL_ID = process.env.COGNITO_POOL_ID || 'us-east-2_Hv31RDYP0';
const REGION = 'us-east-2';
const API_URL = process.env.API_URL || 'https://4g4pnqmotd.execute-api.us-east-2.amazonaws.com/prod';

const JWKS_URI = `https://cognito-idp.${REGION}.amazonaws.com/${COGNITO_POOL_ID}/.well-known/jwks.json`;
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${COGNITO_POOL_ID}`;

const client = jwksClient({ jwksUri: JWKS_URI, cache: true, cacheMaxAge: 600000 });

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

function verifyToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, getKey, { issuer: ISSUER }, (err, decoded) => {
      if (err) return reject(err);
      resolve(decoded);
    });
  });
}

function fetchUserProfile(token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_URL}/auth/me`);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: { Authorization: token }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Org-scoped rooms: { orgId: Set<ws> }
const rooms = {};
// Connection metadata: Map<ws, { email, displayName, orgId }>
const connections = new Map();

// --- HTTP server for health check ---
const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'eemployee-chat',
      version: '2.0',
      port: PORT,
      connections: connections.size,
      rooms: Object.keys(rooms).length
    }));
    return;
  }

  res.writeHead(404);
  res.end();
});

// --- WebSocket server attached to HTTP server ---
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  let authenticated = false;
  let authTimeout = setTimeout(() => {
    if (!authenticated) {
      ws.send(JSON.stringify({ type: 'auth_error', message: 'Authentication timeout' }));
      ws.close();
    }
  }, 10000);

  ws.on('message', async (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.type === 'auth' && !authenticated) {
      try {
        const decoded = await verifyToken(data.token);
        const profile = await fetchUserProfile(data.token);

        if (!profile || !profile.orgId) {
          ws.send(JSON.stringify({ type: 'auth_error', message: 'User profile not found' }));
          ws.close();
          return;
        }

        clearTimeout(authTimeout);
        authenticated = true;

        const meta = {
          email: decoded.email || profile.email,
          displayName: profile.displayName || decoded.email,
          orgId: profile.orgId
        };
        // Kick any existing connection for the same email in this org
        if (rooms[meta.orgId]) {
          for (const peer of rooms[meta.orgId]) {
            const peerMeta = connections.get(peer);
            if (peerMeta && peerMeta.email === meta.email && peer !== ws) {
              peer.onclose = null;
              connections.delete(peer);
              rooms[meta.orgId].delete(peer);
              try { peer.close(); } catch {}
            }
          }
        }

        connections.set(ws, meta);

        if (!rooms[meta.orgId]) rooms[meta.orgId] = new Set();
        rooms[meta.orgId].add(ws);

        ws.send(JSON.stringify({ type: 'auth_success' }));

        // Send current user list (deduplicated by email)
        const seen = new Set();
        const userList = [];
        for (const peer of rooms[meta.orgId]) {
          const peerMeta = connections.get(peer);
          if (peerMeta && !seen.has(peerMeta.email)) {
            seen.add(peerMeta.email);
            userList.push({ email: peerMeta.email, displayName: peerMeta.displayName });
          }
        }
        ws.send(JSON.stringify({ type: 'user_list', users: userList }));

        // Notify others
        broadcast(meta.orgId, {
          type: 'user_joined',
          email: meta.email,
          displayName: meta.displayName
        }, ws);

        console.log(`[+] ${meta.email} joined org ${meta.orgId}`);
      } catch (err) {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid token' }));
        ws.close();
      }
      return;
    }

    if (!authenticated) return;

    if (data.type === 'message') {
      const meta = connections.get(ws);
      if (!meta) return;

      broadcast(meta.orgId, {
        type: 'message',
        from: meta.email,
        payload: data.payload,
        iv: data.iv,
        timestamp: new Date().toISOString()
      });
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    const meta = connections.get(ws);
    if (meta) {
      if (rooms[meta.orgId]) {
        rooms[meta.orgId].delete(ws);
        if (rooms[meta.orgId].size === 0) delete rooms[meta.orgId];
      }
      broadcast(meta.orgId, { type: 'user_left', email: meta.email });
      connections.delete(ws);
      console.log(`[-] ${meta.email} left`);
    }
  });
});

function broadcast(orgId, message, exclude = null) {
  const room = rooms[orgId];
  if (!room) return;
  const payload = JSON.stringify(message);
  for (const c of room) {
    if (c !== exclude && c.readyState === 1) {
      c.send(payload);
    }
  }
}

// Start server
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`E-Employee Chat Server v2.0`);
  console.log(`Listening on port ${PORT}`);
  console.log(`Health check: http://0.0.0.0:${PORT}/health`);
});
