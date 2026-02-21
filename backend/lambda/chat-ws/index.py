import json
import boto3
import urllib.request
import urllib.error
import os
from boto3.dynamodb.conditions import Key

REGION = 'us-east-2'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
connections_table = dynamodb.Table('EEmployee_ChatConnections')
users_table = dynamodb.Table('EEmployee_Users')

# Single shared EC2 chat server URL
CHAT_EC2_URL = os.environ.get('CHAT_EC2_URL', '')


def ec2_request(path, data):
    """Make an HTTP POST to the shared EC2 chat server."""
    if not CHAT_EC2_URL:
        print('CHAT_EC2_URL not configured')
        return None
    url = f'{CHAT_EC2_URL}{path}'
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f'EC2 request failed: {url} - {e}')
        return None


def get_apigw_client(event):
    domain = event['requestContext']['domainName']
    stage = event['requestContext']['stage']
    endpoint = f'https://{domain}/{stage}'
    return boto3.client('apigatewaymanagementapi', endpoint_url=endpoint, region_name=REGION)


def send_to_connection(apigw, connection_id, data):
    try:
        apigw.post_to_connection(ConnectionId=connection_id, Data=json.dumps(data).encode())
    except apigw.exceptions.GoneException:
        connections_table.delete_item(Key={'connectionId': connection_id})
    except Exception as e:
        print(f'Failed to send to {connection_id}: {e}')


def broadcast(apigw, org_id, data, exclude_connection=None, store_id=None):
    """Send data to all connections in an org, filtered by store if specified."""
    resp = connections_table.query(
        IndexName='orgId-index',
        KeyConditionExpression=Key('orgId').eq(org_id)
    )
    for item in resp.get('Items', []):
        cid = item['connectionId']
        if cid == exclude_connection:
            continue
        if store_id and item.get('storeId', '') != store_id:
            continue
        send_to_connection(apigw, cid, data)


def get_room_id(org_id, store_id):
    """Build a unique room key: storeId for infrastructure, orgId otherwise."""
    return store_id if store_id else org_id


def handle_connect(event):
    connection_id = event['requestContext']['connectionId']
    qs = event.get('queryStringParameters') or {}
    token = qs.get('token', '')

    if not token:
        return {'statusCode': 401}

    # Authenticate against the shared EC2 instance
    user_info = ec2_request('/auth', {'token': token})
    if not user_info or not user_info.get('orgId'):
        return {'statusCode': 401}

    # Resolve storeId from query params or user record
    store_id = qs.get('storeId', '')
    if not store_id:
        user_rec = users_table.get_item(Key={'email': user_info['email']}).get('Item', {})
        store_id = user_rec.get('storeId', '')

    room_id = get_room_id(user_info['orgId'], store_id)

    # Join the room on EC2
    ec2_request('/join', {
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
    connection_id = event['requestContext']['connectionId']
    body = event.get('body', '{}')

    try:
        data = json.loads(body)
    except Exception:
        return {'statusCode': 400}

    conn_resp = connections_table.get_item(Key={'connectionId': connection_id})
    conn = conn_resp.get('Item')
    if not conn:
        return {'statusCode': 403}

    org_id = conn['orgId']
    email = conn['email']
    store_id = conn.get('storeId', '')
    room_id = get_room_id(org_id, store_id)
    apigw = get_apigw_client(event)

    msg_type = data.get('type', '')

    if msg_type == 'auth':
        user_list = []
        join_result = ec2_request('/join', {
            'orgId': room_id,
            'email': email,
            'displayName': conn.get('displayName', email)
        })
        if join_result:
            user_list = join_result.get('userList', [])

        send_to_connection(apigw, connection_id, {'type': 'auth_success'})
        send_to_connection(apigw, connection_id, {'type': 'user_list', 'users': user_list})

        broadcast(apigw, org_id, {
            'type': 'user_joined',
            'email': email,
            'displayName': conn.get('displayName', email)
        }, exclude_connection=connection_id, store_id=store_id or None)

        return {'statusCode': 200}

    if msg_type == 'message':
        result = ec2_request('/message', {
            'orgId': room_id,
            'from': email,
            'payload': data.get('payload', ''),
            'iv': data.get('iv', '')
        })
        if result and result.get('broadcast'):
            broadcast(apigw, org_id, result['broadcast'], store_id=store_id or None)

        return {'statusCode': 200}

    return {'statusCode': 200}


def handle_disconnect(event):
    connection_id = event['requestContext']['connectionId']

    conn_resp = connections_table.get_item(Key={'connectionId': connection_id})
    conn = conn_resp.get('Item')

    if conn:
        org_id = conn['orgId']
        email = conn['email']
        store_id = conn.get('storeId', '')
        room_id = get_room_id(org_id, store_id)

        ec2_request('/leave', {'orgId': room_id, 'email': email})

        try:
            apigw = get_apigw_client(event)
            broadcast(apigw, org_id, {
                'type': 'user_left',
                'email': email
            }, exclude_connection=connection_id, store_id=store_id or None)
        except Exception:
            pass

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
