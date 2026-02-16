from decimal import Decimal
import json
import boto3
import uuid
import secrets
from datetime import datetime

dynamodb = boto3.resource('dynamodb', region_name='us-east-2')
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

def get_user_org(email):
    resp = users_table.get_item(Key={'email': email})
    return resp.get('Item')

def create_organization(event):
    body = json.loads(event.get('body', '{}'))
    org_name = body.get('orgName')
    domain = body.get('domain')
    owner_email = get_user_email(event)

    if not org_name or not domain or not owner_email:
        return respond(400, {'error': 'orgName, domain, and valid auth are required'})

    if not owner_email.endswith('@' + domain):
        return respond(400, {'error': 'Your email must match the organization domain'})

    org_id = str(uuid.uuid4())
    encryption_salt = secrets.token_hex(16)
    now = datetime.utcnow().isoformat() + 'Z'

    orgs_table.put_item(Item={
        'orgId': org_id,
        'orgName': org_name,
        'domain': domain,
        'ownerEmail': owner_email,
        'encryptionSalt': encryption_salt,
        'lowStockThreshold': 5,
        'createdAt': now
    })

    users_table.put_item(Item={
        'email': owner_email,
        'orgId': org_id,
        'role': 'admin',
        'displayName': body.get('displayName', owner_email.split('@')[0]),
        'createdAt': now
    })

    return respond(201, {
        'orgId': org_id,
        'orgName': org_name,
        'domain': domain,
        'message': 'Organization created successfully'
    })

def get_organization(event):
    org_id = event['pathParameters']['orgId']
    email = get_user_email(event)

    if not email:
        return respond(401, {'error': 'Unauthorized'})

    user = get_user_org(email)
    if not user or user['orgId'] != org_id:
        return respond(403, {'error': 'You do not belong to this organization'})

    resp = orgs_table.get_item(Key={'orgId': org_id})
    item = resp.get('Item')
    if not item:
        return respond(404, {'error': 'Organization not found'})

    return respond(200, item)

def update_organization(event):
    org_id = event['pathParameters']['orgId']
    email = get_user_email(event)

    if not email:
        return respond(401, {'error': 'Unauthorized'})

    user = get_user_org(email)
    if not user or user['orgId'] != org_id or user['role'] != 'admin':
        return respond(403, {'error': 'Admin access required'})

    body = json.loads(event.get('body', '{}'))
    update_expr_parts = []
    expr_values = {}

    if 'orgName' in body:
        update_expr_parts.append('orgName = :orgName')
        expr_values[':orgName'] = body['orgName']
    if 'lowStockThreshold' in body:
        update_expr_parts.append('lowStockThreshold = :threshold')
        expr_values[':threshold'] = int(body['lowStockThreshold'])
    if 'chatServerHost' in body:
        update_expr_parts.append('chatServerHost = :chatHost')
        expr_values[':chatHost'] = body['chatServerHost']
    if 'chatServerPort' in body:
        port = int(body['chatServerPort'])
        if port < 1024 or port > 65535:
            return respond(400, {'error': 'Port must be between 1024 and 65535'})
        update_expr_parts.append('chatServerPort = :chatPort')
        expr_values[':chatPort'] = port

    if not update_expr_parts:
        return respond(400, {'error': 'No fields to update'})

    orgs_table.update_item(
        Key={'orgId': org_id},
        UpdateExpression='SET ' + ', '.join(update_expr_parts),
        ExpressionAttributeValues=expr_values
    )

    return respond(200, {'message': 'Organization updated'})

def lambda_handler(event, context):
    method = event['httpMethod']
    resource = event.get('resource', '')

    if method == 'OPTIONS':
        return respond(200, {})

    if method == 'POST' and resource == '/organizations':
        return create_organization(event)
    elif method == 'GET' and '/organizations/' in resource:
        return get_organization(event)
    elif method == 'PUT' and '/organizations/' in resource:
        return update_organization(event)
    else:
        return respond(404, {'error': 'Not found'})
