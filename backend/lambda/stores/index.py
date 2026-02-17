import json
import boto3
import uuid
from datetime import datetime
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb', region_name='us-east-2')
stores_table = dynamodb.Table('EEmployee_Stores')
orgs_table = dynamodb.Table('EEmployee_Organizations')
users_table = dynamodb.Table('EEmployee_Users')

FREE_STORE_LIMIT = 3


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


def get_org(org_id):
    resp = orgs_table.get_item(Key={'orgId': org_id})
    return resp.get('Item')


def verify_admin(event):
    email = get_user_email(event)
    if not email:
        return None, None, None, respond(401, {'error': 'Unauthorized'})
    org_id = event['pathParameters']['orgId']
    user = get_user_record(email)
    if not user or user['orgId'] != org_id or user['role'] != 'admin':
        return None, None, None, respond(403, {'error': 'Admin access required'})
    org = get_org(org_id)
    if not org:
        return None, None, None, respond(404, {'error': 'Organization not found'})
    return email, user, org, None


def verify_admin_or_manager(event):
    email = get_user_email(event)
    if not email:
        return None, None, None, respond(401, {'error': 'Unauthorized'})
    org_id = event['pathParameters']['orgId']
    user = get_user_record(email)
    if not user or user['orgId'] != org_id:
        return None, None, None, respond(403, {'error': 'Access denied'})
    if user['role'] not in ('admin', 'manager'):
        return None, None, None, respond(403, {'error': 'Admin or manager access required'})
    org = get_org(org_id)
    if not org:
        return None, None, None, respond(404, {'error': 'Organization not found'})
    return email, user, org, None


def list_stores(event):
    email, user, org, error = verify_admin_or_manager(event)
    if error:
        return error

    org_id = event['pathParameters']['orgId']
    if org.get('tier') != 'infrastructure':
        return respond(400, {'error': 'Multi-store requires the Infrastructure plan'})

    resp = stores_table.query(KeyConditionExpression=Key('orgId').eq(org_id))
    stores = resp.get('Items', [])

    if user['role'] == 'manager':
        stores = [s for s in stores if s.get('managerEmail') == email]

    return respond(200, {'stores': stores, 'freeLimit': FREE_STORE_LIMIT})


def create_store(event):
    email, user, org, error = verify_admin(event)
    if error:
        return error

    org_id = event['pathParameters']['orgId']
    if org.get('tier') != 'infrastructure':
        return respond(400, {'error': 'Multi-store requires the Infrastructure plan'})

    body = json.loads(event.get('body', '{}'))
    store_name = body.get('storeName', '').strip()
    if not store_name:
        return respond(400, {'error': 'storeName is required'})

    existing = stores_table.query(KeyConditionExpression=Key('orgId').eq(org_id))
    store_count = existing.get('Count', 0)

    if store_count >= FREE_STORE_LIMIT:
        extra_subs = org.get('extraStoreSubIds', [])
        paid_extra = len(extra_subs) if isinstance(extra_subs, list) else 0
        if store_count >= FREE_STORE_LIMIT + paid_extra:
            return respond(402, {
                'error': f'You have used all {FREE_STORE_LIMIT} free stores and {paid_extra} paid extras. Purchase another store add-on to continue.',
                'needsExtraStore': True
            })

    store_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat() + 'Z'

    item = {
        'orgId': org_id,
        'storeId': store_id,
        'storeName': store_name,
        'createdAt': now
    }

    stores_table.put_item(Item=item)

    orgs_table.update_item(
        Key={'orgId': org_id},
        UpdateExpression='SET storeCount = :c',
        ExpressionAttributeValues={':c': store_count + 1}
    )

    return respond(201, item)


def get_store(event):
    email, user, org, error = verify_admin_or_manager(event)
    if error:
        return error

    org_id = event['pathParameters']['orgId']
    store_id = event['pathParameters']['storeId']

    resp = stores_table.get_item(Key={'orgId': org_id, 'storeId': store_id})
    store = resp.get('Item')
    if not store:
        return respond(404, {'error': 'Store not found'})

    if user['role'] == 'manager' and store.get('managerEmail') != email:
        return respond(403, {'error': 'You are not the manager of this store'})

    return respond(200, store)


def update_store(event):
    email, user, org, error = verify_admin_or_manager(event)
    if error:
        return error

    org_id = event['pathParameters']['orgId']
    store_id = event['pathParameters']['storeId']

    resp = stores_table.get_item(Key={'orgId': org_id, 'storeId': store_id})
    store = resp.get('Item')
    if not store:
        return respond(404, {'error': 'Store not found'})

    if user['role'] == 'manager' and store.get('managerEmail') != email:
        return respond(403, {'error': 'You are not the manager of this store'})

    body = json.loads(event.get('body', '{}'))
    update_parts = []
    expr_values = {}

    if 'storeName' in body:
        update_parts.append('storeName = :name')
        expr_values[':name'] = body['storeName'].strip()

    if not update_parts:
        return respond(400, {'error': 'No fields to update'})

    stores_table.update_item(
        Key={'orgId': org_id, 'storeId': store_id},
        UpdateExpression='SET ' + ', '.join(update_parts),
        ExpressionAttributeValues=expr_values
    )

    return respond(200, {'message': 'Store updated'})


def delete_store(event):
    email, user, org, error = verify_admin(event)
    if error:
        return error

    org_id = event['pathParameters']['orgId']
    store_id = event['pathParameters']['storeId']

    resp = stores_table.get_item(Key={'orgId': org_id, 'storeId': store_id})
    store = resp.get('Item')
    if not store:
        return respond(404, {'error': 'Store not found'})

    stores_table.delete_item(Key={'orgId': org_id, 'storeId': store_id})

    existing = stores_table.query(KeyConditionExpression=Key('orgId').eq(org_id))
    new_count = existing.get('Count', 0)
    orgs_table.update_item(
        Key={'orgId': org_id},
        UpdateExpression='SET storeCount = :c',
        ExpressionAttributeValues={':c': new_count}
    )

    return respond(200, {'message': f'Store "{store.get("storeName", "")}" deleted'})


def assign_manager(event):
    email, user, org, error = verify_admin(event)
    if error:
        return error

    org_id = event['pathParameters']['orgId']
    store_id = event['pathParameters']['storeId']

    body = json.loads(event.get('body', '{}'))
    manager_email = body.get('managerEmail', '').strip()

    resp = stores_table.get_item(Key={'orgId': org_id, 'storeId': store_id})
    store = resp.get('Item')
    if not store:
        return respond(404, {'error': 'Store not found'})

    if manager_email:
        manager = get_user_record(manager_email)
        if not manager or manager['orgId'] != org_id:
            return respond(404, {'error': 'User not found in this organization'})

        users_table.update_item(
            Key={'email': manager_email},
            UpdateExpression='SET #r = :r, storeId = :s',
            ExpressionAttributeNames={'#r': 'role'},
            ExpressionAttributeValues={':r': 'manager', ':s': store_id}
        )

    if manager_email:
        stores_table.update_item(
            Key={'orgId': org_id, 'storeId': store_id},
            UpdateExpression='SET managerEmail = :m',
            ExpressionAttributeValues={':m': manager_email}
        )
    else:
        # Remove the attribute so the GSI doesn't get an empty string
        stores_table.update_item(
            Key={'orgId': org_id, 'storeId': store_id},
            UpdateExpression='REMOVE managerEmail'
        )

    return respond(200, {
        'message': f'Manager {"assigned" if manager_email else "removed"} for store',
        'managerEmail': manager_email
    })


def lambda_handler(event, context):
    method = event['httpMethod']
    resource = event.get('resource', '')
    path = event.get('path', '')

    if method == 'OPTIONS':
        return respond(200, {})

    has_store_id = '{storeId}' in resource
    has_manager = 'manager' in resource

    if has_manager and method == 'PUT':
        return assign_manager(event)
    elif has_store_id and method == 'GET':
        return get_store(event)
    elif has_store_id and method == 'PUT':
        return update_store(event)
    elif has_store_id and method == 'DELETE':
        return delete_store(event)
    elif not has_store_id and method == 'GET':
        return list_stores(event)
    elif not has_store_id and method == 'POST':
        return create_store(event)
    else:
        return respond(404, {'error': 'Not found'})
