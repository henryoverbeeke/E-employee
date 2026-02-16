const http = require('http');
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

// Org-scoped rooms: { orgId: Set<email> }
const rooms = {};
// User metadata: { email: { email, displayName, orgId } }
const userMeta = {};

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
  });
}

function respond(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(body));
}

const httpServer = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    respond(res, 204, {});
    return;
  }

  if (req.url === '/health' && req.method === 'GET') {
    respond(res, 200, {
      status: 'ok',
      service: 'eemployee-chat',
      version: '3.0',
      port: PORT,
      rooms: Object.keys(rooms).length,
      users: Object.keys(userMeta).length
    });
    return;
  }

  if (req.url === '/auth' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.token) {
      respond(res, 400, { error: 'token required' });
      return;
    }
    try {
      const decoded = await verifyToken(body.token);
      const profile = await fetchUserProfile(body.token);
      if (!profile || !profile.orgId) {
        respond(res, 401, { error: 'User profile not found' });
        return;
      }
      respond(res, 200, {
        email: decoded.email || profile.email,
        displayName: profile.displayName || decoded.email,
        orgId: profile.orgId
      });
    } catch (err) {
      respond(res, 401, { error: 'Invalid token' });
    }
    return;
  }

  if (req.url === '/join' && req.method === 'POST') {
    const body = await readBody(req);
    const { orgId, email, displayName } = body;
    if (!orgId || !email) {
      respond(res, 400, { error: 'orgId and email required' });
      return;
    }

    // Remove from any previous room
    for (const rid of Object.keys(rooms)) {
      rooms[rid].delete(email);
      if (rooms[rid].size === 0) delete rooms[rid];
    }

    if (!rooms[orgId]) rooms[orgId] = new Set();
    rooms[orgId].add(email);
    userMeta[email] = { email, displayName, orgId };

    const userList = [];
    for (const e of rooms[orgId]) {
      if (userMeta[e]) userList.push({ email: e, displayName: userMeta[e].displayName });
    }

    console.log(`[+] ${email} joined org ${orgId}`);
    respond(res, 200, { userList });
    return;
  }

  if (req.url === '/leave' && req.method === 'POST') {
    const body = await readBody(req);
    const { orgId, email } = body;
    if (!orgId || !email) {
      respond(res, 400, { error: 'orgId and email required' });
      return;
    }

    if (rooms[orgId]) {
      rooms[orgId].delete(email);
      if (rooms[orgId].size === 0) delete rooms[orgId];
    }
    delete userMeta[email];

    console.log(`[-] ${email} left org ${orgId}`);
    respond(res, 200, { ok: true });
    return;
  }

  if (req.url === '/message' && req.method === 'POST') {
    const body = await readBody(req);
    const { orgId, from, payload, iv } = body;
    if (!orgId || !from) {
      respond(res, 400, { error: 'orgId and from required' });
      return;
    }

    respond(res, 200, {
      broadcast: {
        type: 'message',
        from,
        payload,
        iv,
        timestamp: new Date().toISOString()
      }
    });
    return;
  }

  respond(res, 404, { error: 'Not found' });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`E-Employee Chat Server v3.0 (HTTP API)`);
  console.log(`Listening on port ${PORT}`);
  console.log(`Health: http://0.0.0.0:${PORT}/health`);
});
