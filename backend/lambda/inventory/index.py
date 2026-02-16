from decimal import Decimal
import json
import boto3
import uuid
from datetime import datetime
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb', region_name='us-east-2')
inventory_table = dynamodb.Table('EEmployee_Inventory')
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

def verify_org_member(event):
    email = get_user_email(event)
    if not email:
        return None, None, respond(401, {'error': 'Unauthorized'})

    org_id = event['pathParameters']['orgId']
    user = get_user_record(email)
    if not user or user['orgId'] != org_id:
        return None, None, respond(403, {'error': 'You do not belong to this organization'})

    return email, user, None

def list_inventory(event):
    email, user, error = verify_org_member(event)
    if error:
        return error

    org_id = event['pathParameters']['orgId']
    resp = inventory_table.query(KeyConditionExpression=Key('orgId').eq(org_id))
    items = resp.get('Items', [])

    org_resp = orgs_table.get_item(Key={'orgId': org_id})
    org = org_resp.get('Item', {})
    default_threshold = org.get('lowStockThreshold', 5)

    for item in items:
        threshold = item.get('lowStockThreshold', default_threshold)
        qty = item.get('quantity', 0)
        if qty == 0:
            item['alertStatus'] = 'out_of_stock'
        elif qty <= threshold:
            item['alertStatus'] = 'low_stock'
        else:
            item['alertStatus'] = 'ok'

    return respond(200, {'items': items})

def add_item(event):
    email, user, error = verify_org_member(event)
    if error:
        return error

    org_id = event['pathParameters']['orgId']
    body = json.loads(event.get('body', '{}'))
    item_name = body.get('itemName')
    quantity = body.get('quantity', 0)

    if not item_name:
        return respond(400, {'error': 'itemName is required'})

    item_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat() + 'Z'

    item = {
        'orgId': org_id,
        'itemId': item_id,
        'itemName': item_name,
        'quantity': int(quantity),
        'updatedAt': now,
        'updatedBy': email
    }

    if 'lowStockThreshold' in body:
        item['lowStockThreshold'] = int(body['lowStockThreshold'])

    inventory_table.put_item(Item=item)

    return respond(201, item)

def update_item(event):
    email, user, error = verify_org_member(event)
    if error:
        return error

    org_id = event['pathParameters']['orgId']
    item_id = event['pathParameters']['itemId']
    body = json.loads(event.get('body', '{}'))

    now = datetime.utcnow().isoformat() + 'Z'
    update_parts = ['updatedAt = :now', 'updatedBy = :by']
    expr_values = {':now': now, ':by': email}

    if 'quantity' in body:
        update_parts.append('quantity = :qty')
        expr_values[':qty'] = int(body['quantity'])
    if 'itemName' in body:
        update_parts.append('itemName = :name')
        expr_values[':name'] = body['itemName']
    if 'lowStockThreshold' in body:
        update_parts.append('lowStockThreshold = :threshold')
        expr_values[':threshold'] = int(body['lowStockThreshold'])

    inventory_table.update_item(
        Key={'orgId': org_id, 'itemId': item_id},
        UpdateExpression='SET ' + ', '.join(update_parts),
        ExpressionAttributeValues=expr_values
    )

    return respond(200, {'message': 'Item updated'})

def delete_item(event):
    email, user, error = verify_org_member(event)
    if error:
        return error

    org_id = event['pathParameters']['orgId']
    item_id = event['pathParameters']['itemId']

    inventory_table.delete_item(Key={'orgId': org_id, 'itemId': item_id})

    return respond(200, {'message': 'Item deleted'})

def get_alerts(event):
    email, user, error = verify_org_member(event)
    if error:
        return error

    org_id = event['pathParameters']['orgId']
    resp = inventory_table.query(KeyConditionExpression=Key('orgId').eq(org_id))
    items = resp.get('Items', [])

    org_resp = orgs_table.get_item(Key={'orgId': org_id})
    org = org_resp.get('Item', {})
    default_threshold = org.get('lowStockThreshold', 5)

    alerts = []
    for item in items:
        threshold = item.get('lowStockThreshold', default_threshold)
        qty = item.get('quantity', 0)
        if qty == 0:
            alerts.append({**item, 'alertStatus': 'out_of_stock'})
        elif qty <= threshold:
            alerts.append({**item, 'alertStatus': 'low_stock'})

    return respond(200, {'alerts': alerts, 'totalAlerts': len(alerts)})

def lambda_handler(event, context):
    method = event['httpMethod']
    resource = event.get('resource', '')

    if method == 'OPTIONS':
        return respond(200, {})

    if 'alerts' in resource and method == 'GET':
        return get_alerts(event)
    elif method == 'GET' and '{itemId}' not in resource:
        return list_inventory(event)
    elif method == 'POST':
        return add_item(event)
    elif method == 'PUT':
        return update_item(event)
    elif method == 'DELETE':
        return delete_item(event)
    else:
        return respond(404, {'error': 'Not found'})
