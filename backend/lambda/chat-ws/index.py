import json
import boto3
import urllib.request
import urllib.error
import os
from boto3.dynamodb.conditions import Key

REGION = 'us-east-2'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
connections_table = dynamodb.Table('EEmployee_ChatConnections')
orgs_table = dynamodb.Table('EEmployee_Organizations')
users_table = dynamodb.Table('EEmployee_Users')


def get_ec2_url(org_id):
    """Get the EC2 chat server URL from the org record."""
    resp = orgs_table.get_item(Key={'orgId': org_id})
    org = resp.get('Item', {})
    host = org.get('chatServerHost', '')
    port = int(org.get('chatServerPort', 8765))
    if not host:
        return None
    return f'http://{host}:{port}'


def ec2_request(url, data):
    """Make an HTTP POST to the EC2 chat server."""
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f'EC2 request failed: {url} - {e}')
        return None


def get_apigw_client(event):
    """Build the API Gateway Management API client from the event context."""
    domain = event['requestContext']['domainName']
    stage = event['requestContext']['stage']
    endpoint = f'https://{domain}/{stage}'
    return boto3.client('apigatewaymanagementapi', endpoint_url=endpoint, region_name=REGION)


def send_to_connection(apigw, connection_id, data):
    """Send data to a specific WebSocket connection."""
    try:
        apigw.post_to_connection(ConnectionId=connection_id, Data=json.dumps(data).encode())
    except apigw.exceptions.GoneException:
        connections_table.delete_item(Key={'connectionId': connection_id})
    except Exception as e:
        print(f'Failed to send to {connection_id}: {e}')


def broadcast_to_org(apigw, org_id, data, exclude_connection=None, store_id=None):
    """Send data to all connections in an org (or store if specified)."""
    resp = connections_table.query(
        IndexName='orgId-index',
        KeyConditionExpression=Key('orgId').eq(org_id)
    )
    for item in resp.get('Items', []):
        cid = item['connectionId']
        if cid == exclude_connection:
            continue
        # If store_id filtering is active, only send to same store
        if store_id and item.get('storeId', '') != store_id:
            continue
        send_to_connection(apigw, cid, data)


def handle_connect(event):
    """Handle $connect - authenticate and join."""
    connection_id = event['requestContext']['connectionId']
    qs = event.get('queryStringParameters') or {}
    token = qs.get('token', '')

    if not token:
        return {'statusCode': 401}

    # Find the org for this user by calling EC2 /auth
    # First we need to find which org's EC2 to call. We'll check all orgs.
    # For now, scan for orgs with a running chat server.
    scan = orgs_table.scan(
        FilterExpression='chatServerStatus = :s',
        ExpressionAttributeValues={':s': 'running'}
    )
    orgs = scan.get('Items', [])

    user_info = None
    ec2_url = None
    for org in orgs:
        host = org.get('chatServerHost', '')
        port = int(org.get('chatServerPort', 8765))
        if not host:
            continue
        url = f'http://{host}:{port}'
        result = ec2_request(f'{url}/auth', {'token': token})
        if result and result.get('orgId') and result['orgId'] == org['orgId']:
            user_info = result
            ec2_url = url
            break

    if not user_info:
        return {'statusCode': 401}

    # Look up storeId from query params or user record
    store_id = qs.get('storeId', '')
    if not store_id:
        user_rec = users_table.get_item(Key={'email': user_info['email']}).get('Item', {})
        store_id = user_rec.get('storeId', '')

    # For infrastructure tier, use storeId as the room key
    room_id = store_id if store_id else user_info['orgId']

    # Join the room on EC2
    join_result = ec2_request(f'{ec2_url}/join', {
        'orgId': room_id,
        'email': user_info['email'],
        'displayName': user_info['displayName']
    })

    # Store connection in DynamoDB
    conn_item = {
        'connectionId': connection_id,
        'orgId': user_info['orgId'],
        'email': user_info['email'],
        'displayName': user_info['displayName']
    }
    if store_id:
        conn_item['storeId'] = store_id
    connections_table.put_item(Item=conn_item)

    return {'statusCode': 200}


def handle_default(event):
    """Handle $default - relay messages."""
    connection_id = event['requestContext']['connectionId']
    body = event.get('body', '{}')

    try:
        data = json.loads(body)
    except Exception:
        return {'statusCode': 400}

    # Look up connection info
    conn_resp = connections_table.get_item(Key={'connectionId': connection_id})
    conn = conn_resp.get('Item')
    if not conn:
        return {'statusCode': 403}

    org_id = conn['orgId']
    email = conn['email']
    store_id = conn.get('storeId', '')
    room_id = store_id if store_id else org_id
    apigw = get_apigw_client(event)

    msg_type = data.get('type', '')

    if msg_type == 'auth':
        ec2_url = get_ec2_url(org_id)
        user_list = []
        if ec2_url:
            join_result = ec2_request(f'{ec2_url}/join', {
                'orgId': room_id,
                'email': email,
                'displayName': conn.get('displayName', email)
            })
            if join_result:
                user_list = join_result.get('userList', [])

        send_to_connection(apigw, connection_id, {'type': 'auth_success'})
        send_to_connection(apigw, connection_id, {'type': 'user_list', 'users': user_list})

        broadcast_to_org(apigw, org_id, {
            'type': 'user_joined',
            'email': email,
            'displayName': conn.get('displayName', email)
        }, exclude_connection=connection_id, store_id=store_id or None)

        return {'statusCode': 200}

    if msg_type == 'message':
        ec2_url = get_ec2_url(org_id)
        if ec2_url:
            result = ec2_request(f'{ec2_url}/message', {
                'orgId': room_id,
                'from': email,
                'payload': data.get('payload', ''),
                'iv': data.get('iv', '')
            })
            if result and result.get('broadcast'):
                broadcast_to_org(apigw, org_id, result['broadcast'], store_id=store_id or None)

        return {'statusCode': 200}

    return {'statusCode': 200}


def handle_disconnect(event):
    """Handle $disconnect - clean up."""
    connection_id = event['requestContext']['connectionId']

    # Look up connection
    conn_resp = connections_table.get_item(Key={'connectionId': connection_id})
    conn = conn_resp.get('Item')

    if conn:
        org_id = conn['orgId']
        email = conn['email']
        store_id = conn.get('storeId', '')
        room_id = store_id if store_id else org_id

        # Tell EC2 to remove from room
        ec2_url = get_ec2_url(org_id)
        if ec2_url:
            ec2_request(f'{ec2_url}/leave', {'orgId': room_id, 'email': email})

        # Notify others
        try:
            apigw = get_apigw_client(event)
            broadcast_to_org(apigw, org_id, {
                'type': 'user_left',
                'email': email
            }, exclude_connection=connection_id, store_id=store_id or None)
        except Exception:
            pass

        # Delete from DynamoDB
        connections_table.delete_item(Key={'connectionId': connection_id})

    return {'statusCode': 200}


def lambda_handler(event, context):
    route = event['requestContext'].get('routeKey', '')

    if route == '$connect':
        return handle_connect(event)
    elif route == '$disconnect':
        return handle_disconnect(event)
    else:
        return handle_default(event)
