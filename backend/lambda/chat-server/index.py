import json
import boto3
import base64
import time
from datetime import datetime

REGION = 'us-east-2'
SECURITY_GROUP_ID = 'sg-0b9cb00199728b2a5'
KEY_NAME = 'eemployee-chat-key'
INSTANCE_TYPE = 't3.micro'
AMI_ID = 'ami-05efc83cb5512477c'

ec2 = boto3.client('ec2', region_name=REGION)
dynamodb = boto3.resource('dynamodb', region_name=REGION)
orgs_table = dynamodb.Table('EEmployee_Organizations')
users_table = dynamodb.Table('EEmployee_Users')


def respond(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        'body': json.dumps(body, default=str)
    }


def get_user_email(event):
    try:
        return event['requestContext']['authorizer']['claims']['email']
    except (KeyError, TypeError):
        return None


def get_user_record(email):
    resp = users_table.get_item(Key={'email': email})
    return resp.get('Item')


def get_user_data_script(port):
    """Build the EC2 user-data script that installs and starts the chat server."""
    return f"""#!/bin/bash
set -e

# Install Node.js
dnf install -y nodejs npm

# Create app directory
mkdir -p /opt/eemployee-chat
cd /opt/eemployee-chat

# Write package.json
cat > package.json << 'PKGJSON'
{{
  "name": "eemployee-chat-server",
  "version": "2.0.0",
  "main": "server.js",
  "dependencies": {{
    "ws": "^8.18.0",
    "jsonwebtoken": "^9.0.2",
    "jwks-rsa": "^3.1.0"
  }}
}}
PKGJSON

# Write server.js
cat > server.js << 'SERVERJS'
const http = require('http');
const {{ WebSocketServer }} = require('ws');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const https = require('https');

const fs = require('fs');
const path = require('path');
const {{ execSync }} = require('child_process');

const PORT = process.env.PORT || {port};
const WSS_PORT = process.env.WSS_PORT || {port + 1};
const COGNITO_POOL_ID = process.env.COGNITO_POOL_ID || 'us-east-2_Hv31RDYP0';
const REGION = 'us-east-2';
const API_URL = process.env.API_URL || 'https://4g4pnqmotd.execute-api.us-east-2.amazonaws.com/prod';

const JWKS_URI = `https://cognito-idp.${{REGION}}.amazonaws.com/${{COGNITO_POOL_ID}}/.well-known/jwks.json`;
const ISSUER = `https://cognito-idp.${{REGION}}.amazonaws.com/${{COGNITO_POOL_ID}}`;

const client = jwksClient({{ jwksUri: JWKS_URI, cache: true, cacheMaxAge: 600000 }});

function getKey(header, callback) {{
  client.getSigningKey(header.kid, (err, key) => {{
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  }});
}}

function verifyToken(token) {{
  return new Promise((resolve, reject) => {{
    jwt.verify(token, getKey, {{ issuer: ISSUER }}, (err, decoded) => {{
      if (err) return reject(err);
      resolve(decoded);
    }});
  }});
}}

function fetchUserProfile(token) {{
  return new Promise((resolve, reject) => {{
    const url = new URL(`${{API_URL}}/auth/me`);
    const options = {{
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {{ Authorization: token }}
    }};
    const req = https.request(options, (res) => {{
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {{
        try {{ resolve(JSON.parse(data)); }}
        catch (e) {{ reject(e); }}
      }});
    }});
    req.on('error', reject);
    req.end();
  }});
}}

const rooms = {{}};
const connections = new Map();

const httpServer = http.createServer((req, res) => {{
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {{ res.writeHead(204); res.end(); return; }}

  if (req.url === '/health') {{
    res.writeHead(200, {{ 'Content-Type': 'application/json' }});
    res.end(JSON.stringify({{
      status: 'ok', service: 'eemployee-chat', version: '2.0',
      port: PORT, connections: connections.size, rooms: Object.keys(rooms).length
    }}));
    return;
  }}
  res.writeHead(404); res.end();
}});

const wss = new WebSocketServer({{ server: httpServer }});

wss.on('connection', (ws) => {{
  let authenticated = false;
  let authTimeout = setTimeout(() => {{
    if (!authenticated) {{
      ws.send(JSON.stringify({{ type: 'auth_error', message: 'Authentication timeout' }}));
      ws.close();
    }}
  }}, 10000);

  ws.on('message', async (raw) => {{
    let data;
    try {{ data = JSON.parse(raw.toString()); }} catch {{ return; }}

    if (data.type === 'auth' && !authenticated) {{
      try {{
        const decoded = await verifyToken(data.token);
        const profile = await fetchUserProfile(data.token);
        if (!profile || !profile.orgId) {{
          ws.send(JSON.stringify({{ type: 'auth_error', message: 'User profile not found' }}));
          ws.close(); return;
        }}
        clearTimeout(authTimeout);
        authenticated = true;
        const meta = {{
          email: decoded.email || profile.email,
          displayName: profile.displayName || decoded.email,
          orgId: profile.orgId
        }};
        if (rooms[meta.orgId]) {{
          for (const peer of rooms[meta.orgId]) {{
            const peerMeta = connections.get(peer);
            if (peerMeta && peerMeta.email === meta.email && peer !== ws) {{
              peer.onclose = null;
              connections.delete(peer);
              rooms[meta.orgId].delete(peer);
              try {{ peer.close(); }} catch {{}}
            }}
          }}
        }}
        connections.set(ws, meta);
        if (!rooms[meta.orgId]) rooms[meta.orgId] = new Set();
        rooms[meta.orgId].add(ws);
        ws.send(JSON.stringify({{ type: 'auth_success' }}));
        const seen = new Set();
        const userList = [];
        for (const peer of rooms[meta.orgId]) {{
          const peerMeta = connections.get(peer);
          if (peerMeta && !seen.has(peerMeta.email)) {{
            seen.add(peerMeta.email);
            userList.push({{ email: peerMeta.email, displayName: peerMeta.displayName }});
          }}
        }}
        ws.send(JSON.stringify({{ type: 'user_list', users: userList }}));
        broadcast(meta.orgId, {{ type: 'user_joined', email: meta.email, displayName: meta.displayName }}, ws);
        console.log(`[+] ${{meta.email}} joined org ${{meta.orgId}}`);
      }} catch (err) {{
        ws.send(JSON.stringify({{ type: 'auth_error', message: 'Invalid token' }}));
        ws.close();
      }}
      return;
    }}
    if (!authenticated) return;
    if (data.type === 'message') {{
      const meta = connections.get(ws);
      if (!meta) return;
      broadcast(meta.orgId, {{
        type: 'message', from: meta.email,
        payload: data.payload, iv: data.iv, timestamp: new Date().toISOString()
      }});
    }}
  }});

  ws.on('close', () => {{
    clearTimeout(authTimeout);
    const meta = connections.get(ws);
    if (meta) {{
      if (rooms[meta.orgId]) {{
        rooms[meta.orgId].delete(ws);
        if (rooms[meta.orgId].size === 0) delete rooms[meta.orgId];
      }}
      broadcast(meta.orgId, {{ type: 'user_left', email: meta.email }});
      connections.delete(ws);
      console.log(`[-] ${{meta.email}} left`);
    }}
  }});
}});

function broadcast(orgId, message, exclude = null) {{
  const room = rooms[orgId];
  if (!room) return;
  const payload = JSON.stringify(message);
  for (const c of room) {{
    if (c !== exclude && c.readyState === 1) c.send(payload);
  }}
}}

function ensureCert() {{
  const certDir = path.join(__dirname, 'certs');
  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');
  if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, {{ recursive: true }});
  if (!fs.existsSync(keyPath)) {{
    execSync(`openssl req -x509 -newkey rsa:2048 -keyout ${{keyPath}} -out ${{certPath}} -days 365 -nodes -subj "/CN=eemployee-chat"`, {{ stdio: 'ignore' }});
  }}
  return {{ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }};
}}

function handleHttps(req, res) {{
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/health') {{
    res.writeHead(200, {{ 'Content-Type': 'application/json' }});
    res.end(JSON.stringify({{ status: 'ok', wss: true }}));
    return;
  }}
  res.writeHead(200, {{ 'Content-Type': 'text/html' }});
  res.end('<html><body style="font-family:sans-serif;text-align:center;padding:4rem"><h2>Certificate accepted!</h2><p>You can close this tab and go back to chat.</p></body></html>');
}}

try {{
  const tlsOpts = ensureCert();
  const httpsServer = https.createServer(tlsOpts, handleHttps);
  const wssSecure = new WebSocketServer({{ server: httpsServer }});
  wssSecure.on('connection', (ws) => wss.emit('connection', ws));
  httpsServer.listen(WSS_PORT, '0.0.0.0', () => console.log(`WSS on port ${{WSS_PORT}}`));
}} catch (e) {{
  console.log('WSS not available:', e.message);
}}

httpServer.listen(PORT, '0.0.0.0', () => {{
  console.log(`E-Employee Chat Server v2.0 | WS:${{PORT}} WSS:${{WSS_PORT}}`);
}});
SERVERJS

# Install dependencies
npm install --production

# Create systemd service
cat > /etc/systemd/system/eemployee-chat.service << SVCEOF
[Unit]
Description=E-Employee Chat Server
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/eemployee-chat
ExecStart=/usr/bin/node /opt/eemployee-chat/server.js
Restart=always
RestartSec=5
Environment=PORT={port}
Environment=WSS_PORT={port + 1}

[Install]
WantedBy=multi-user.target
SVCEOF

chown -R ec2-user:ec2-user /opt/eemployee-chat
systemctl daemon-reload
systemctl enable eemployee-chat
systemctl start eemployee-chat
"""


def create_chat_server(event):
    email = get_user_email(event)
    if not email:
        return respond(401, {'error': 'Unauthorized'})

    org_id = event['pathParameters']['orgId']
    user = get_user_record(email)
    if not user or user['orgId'] != org_id or user['role'] != 'admin':
        return respond(403, {'error': 'Admin access required'})

    # Check if org already has a chat server
    org_resp = orgs_table.get_item(Key={'orgId': org_id})
    org = org_resp.get('Item', {})

    if org.get('chatServerInstanceId') and org.get('chatServerStatus') != 'terminated':
        return respond(409, {
            'error': 'Chat server already exists',
            'chatServerHost': org.get('chatServerHost', ''),
            'chatServerPort': int(org.get('chatServerPort', 8765)),
            'chatServerStatus': org.get('chatServerStatus', 'unknown')
        })

    body = json.loads(event.get('body', '{}'))
    port = int(body.get('port', 8765))
    if port < 1024 or port > 65535:
        return respond(400, {'error': 'Port must be between 1024 and 65535'})

    # Mark as starting in DynamoDB immediately
    now = datetime.utcnow().isoformat() + 'Z'
    orgs_table.update_item(
        Key={'orgId': org_id},
        UpdateExpression='SET chatServerStatus = :status, chatServerPort = :port, chatServerCreatedAt = :now',
        ExpressionAttributeValues={
            ':status': 'starting',
            ':port': port,
            ':now': now
        }
    )

    # Build user-data
    user_data = get_user_data_script(port)
    user_data_b64 = base64.b64encode(user_data.encode()).decode()

    # Launch EC2 and return immediately (API GW has 29s limit)
    try:
        response = ec2.run_instances(
            ImageId=AMI_ID,
            InstanceType=INSTANCE_TYPE,
            KeyName=KEY_NAME,
            SecurityGroupIds=[SECURITY_GROUP_ID],
            MinCount=1,
            MaxCount=1,
            UserData=user_data_b64,
            TagSpecifications=[{
                'ResourceType': 'instance',
                'Tags': [
                    {'Key': 'Name', 'Value': f'EEmployee-Chat-{org_id[:8]}'},
                    {'Key': 'OrgId', 'Value': org_id},
                    {'Key': 'Service', 'Value': 'eemployee-chat'}
                ]
            }]
        )

        instance_id = response['Instances'][0]['InstanceId']

        # Save the instance ID immediately. Status remains 'starting'.
        # The GET endpoint will poll EC2 for the public IP once it's running.
        orgs_table.update_item(
            Key={'orgId': org_id},
            UpdateExpression='SET chatServerPort = :port, chatServerInstanceId = :iid, chatServerStatus = :status',
            ExpressionAttributeValues={
                ':port': port,
                ':iid': instance_id,
                ':status': 'starting'
            }
        )

        return respond(201, {
            'message': 'Chat server is being created. It may take a few minutes to boot.',
            'instanceId': instance_id,
            'chatServerPort': port,
            'chatServerStatus': 'starting'
        })

    except Exception as e:
        orgs_table.update_item(
            Key={'orgId': org_id},
            UpdateExpression='SET chatServerStatus = :status',
            ExpressionAttributeValues={':status': 'failed'}
        )
        return respond(500, {'error': f'Failed to launch chat server: {str(e)}'})


def get_chat_server_status(event):
    email = get_user_email(event)
    if not email:
        return respond(401, {'error': 'Unauthorized'})

    org_id = event['pathParameters']['orgId']
    user = get_user_record(email)
    if not user or user['orgId'] != org_id:
        return respond(403, {'error': 'You do not belong to this organization'})

    org_resp = orgs_table.get_item(Key={'orgId': org_id})
    org = org_resp.get('Item', {})

    instance_id = org.get('chatServerInstanceId')
    status = org.get('chatServerStatus', 'none')
    host = org.get('chatServerHost', '')
    port = int(org.get('chatServerPort', 8765))

    # If stopped, verify actual EC2 state
    if status == 'stopped' and instance_id:
        try:
            desc = ec2.describe_instances(InstanceIds=[instance_id])
            inst = desc['Reservations'][0]['Instances'][0]
            state = inst['State']['Name']
            if state == 'terminated':
                status = 'terminated'
                orgs_table.update_item(
                    Key={'orgId': org_id},
                    UpdateExpression='SET chatServerStatus = :status',
                    ExpressionAttributeValues={':status': 'terminated'}
                )
        except Exception:
            pass

    # If starting, check EC2 for public IP
    if status == 'starting' and instance_id:
        try:
            desc = ec2.describe_instances(InstanceIds=[instance_id])
            inst = desc['Reservations'][0]['Instances'][0]
            state = inst['State']['Name']
            public_ip = inst.get('PublicIpAddress', '')

            if state == 'running' and public_ip:
                host = public_ip
                status = 'booting'
                orgs_table.update_item(
                    Key={'orgId': org_id},
                    UpdateExpression='SET chatServerHost = :host, chatServerStatus = :status',
                    ExpressionAttributeValues={':host': host, ':status': 'booting'}
                )
            elif state in ('terminated', 'shutting-down'):
                status = 'failed'
                orgs_table.update_item(
                    Key={'orgId': org_id},
                    UpdateExpression='SET chatServerStatus = :status',
                    ExpressionAttributeValues={':status': 'failed'}
                )
        except Exception:
            pass

    # If booting, check if the health endpoint is responding
    if status == 'booting' and host:
        import urllib.request
        try:
            req = urllib.request.urlopen(f'http://{host}:{port}/health', timeout=3)
            data = json.loads(req.read())
            if data.get('status') == 'ok':
                status = 'running'
                orgs_table.update_item(
                    Key={'orgId': org_id},
                    UpdateExpression='SET chatServerStatus = :status',
                    ExpressionAttributeValues={':status': 'running'}
                )
        except Exception:
            pass

    return respond(200, {
        'chatServerHost': host,
        'chatServerPort': port,
        'chatServerStatus': status,
        'chatServerInstanceId': instance_id or ''
    })


def toggle_chat_server(event):
    """PUT: start or stop the EC2 instance."""
    email = get_user_email(event)
    if not email:
        return respond(401, {'error': 'Unauthorized'})

    org_id = event['pathParameters']['orgId']
    user = get_user_record(email)
    if not user or user['orgId'] != org_id or user['role'] != 'admin':
        return respond(403, {'error': 'Admin access required'})

    body = json.loads(event.get('body', '{}'))
    action = body.get('action')  # 'start' or 'stop'
    if action not in ('start', 'stop'):
        return respond(400, {'error': 'action must be "start" or "stop"'})

    org_resp = orgs_table.get_item(Key={'orgId': org_id})
    org = org_resp.get('Item', {})
    instance_id = org.get('chatServerInstanceId')

    if not instance_id:
        return respond(404, {'error': 'No chat server found'})

    try:
        if action == 'stop':
            ec2.stop_instances(InstanceIds=[instance_id])
            orgs_table.update_item(
                Key={'orgId': org_id},
                UpdateExpression='SET chatServerStatus = :status',
                ExpressionAttributeValues={':status': 'stopped'}
            )
            return respond(200, {'message': 'Chat server is stopping', 'chatServerStatus': 'stopped'})
        else:
            ec2.start_instances(InstanceIds=[instance_id])
            # When starting a stopped instance, the public IP may change
            orgs_table.update_item(
                Key={'orgId': org_id},
                UpdateExpression='SET chatServerStatus = :status REMOVE chatServerHost',
                ExpressionAttributeValues={':status': 'starting'}
            )
            return respond(200, {'message': 'Chat server is starting. It may take a minute.', 'chatServerStatus': 'starting'})
    except Exception as e:
        return respond(500, {'error': f'Failed to {action} chat server: {str(e)}'})


def delete_chat_server(event):
    email = get_user_email(event)
    if not email:
        return respond(401, {'error': 'Unauthorized'})

    org_id = event['pathParameters']['orgId']
    user = get_user_record(email)
    if not user or user['orgId'] != org_id or user['role'] != 'admin':
        return respond(403, {'error': 'Admin access required'})

    org_resp = orgs_table.get_item(Key={'orgId': org_id})
    org = org_resp.get('Item', {})

    instance_id = org.get('chatServerInstanceId')
    if not instance_id:
        return respond(404, {'error': 'No chat server found'})

    try:
        ec2.terminate_instances(InstanceIds=[instance_id])
    except Exception:
        pass

    orgs_table.update_item(
        Key={'orgId': org_id},
        UpdateExpression='SET chatServerStatus = :status REMOVE chatServerHost, chatServerInstanceId',
        ExpressionAttributeValues={':status': 'terminated'}
    )

    return respond(200, {'message': 'Chat server terminated'})


def lambda_handler(event, context):
    method = event['httpMethod']
    resource = event.get('resource', '')

    if method == 'OPTIONS':
        return respond(200, {})

    if method == 'POST' and 'chat-server' in resource:
        return create_chat_server(event)
    elif method == 'GET' and 'chat-server' in resource:
        return get_chat_server_status(event)
    elif method == 'PUT' and 'chat-server' in resource:
        return toggle_chat_server(event)
    elif method == 'DELETE' and 'chat-server' in resource:
        return delete_chat_server(event)
    else:
        return respond(404, {'error': 'Not found'})
