from decimal import Decimal
import json
import boto3
import os
import random
from datetime import datetime

dynamodb = boto3.resource('dynamodb', region_name='us-east-2')
users_table = dynamodb.Table('EEmployee_Users')
orgs_table = dynamodb.Table('EEmployee_Organizations')
cognito = boto3.client('cognito-idp', region_name='us-east-2')

USER_POOL_ID = os.environ.get('USER_POOL_ID', '')

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

def get_me(event):
    email = get_user_email(event)
    if not email:
        return respond(401, {'error': 'Unauthorized'})

    user = get_user_record(email)
    if not user:
        return respond(404, {'error': 'User profile not found'})

    # Include org tier in the profile
    if user.get('orgId'):
        org_resp = orgs_table.get_item(Key={'orgId': user['orgId']})
        org = org_resp.get('Item')
        if org:
            user['tier'] = org.get('tier', 'none')

    return respond(200, user)

def list_employees(event):
    org_id = event['pathParameters']['orgId']
    email = get_user_email(event)

    if not email:
        return respond(401, {'error': 'Unauthorized'})

    caller = get_user_record(email)
    if not caller or caller['orgId'] != org_id:
        return respond(403, {'error': 'You do not belong to this organization'})

    resp = users_table.query(
        IndexName='orgId-index',
        KeyConditionExpression=boto3.dynamodb.conditions.Key('orgId').eq(org_id)
    )

    return respond(200, {'employees': resp.get('Items', [])})

def create_employee(event):
    org_id = event['pathParameters']['orgId']
    email = get_user_email(event)

    if not email:
        return respond(401, {'error': 'Unauthorized'})

    caller = get_user_record(email)
    if not caller or caller['orgId'] != org_id or caller['role'] != 'admin':
        return respond(403, {'error': 'Admin access required'})

    body = json.loads(event.get('body', '{}'))
    emp_email = body.get('email')
    display_name = body.get('displayName', '')

    if not emp_email:
        return respond(400, {'error': 'email is required'})

    org_resp = orgs_table.get_item(Key={'orgId': org_id})
    org = org_resp.get('Item')
    if not org:
        return respond(404, {'error': 'Organization not found'})

    if not emp_email.endswith('@' + org['domain']):
        return respond(400, {'error': f"Employee email must end with @{org['domain']}"})

    existing = get_user_record(emp_email)
    if existing:
        return respond(409, {'error': 'User already exists'})

    temp_password = 'Ee' + str(random.randint(100000, 999999))

    try:
        cognito.admin_create_user(
            UserPoolId=USER_POOL_ID,
            Username=emp_email,
            TemporaryPassword=temp_password,
            UserAttributes=[
                {'Name': 'email', 'Value': emp_email},
                {'Name': 'email_verified', 'Value': 'true'}
            ],
            MessageAction='SUPPRESS'
        )
    except cognito.exceptions.UsernameExistsException:
        pass
    except Exception as e:
        return respond(500, {'error': f'Failed to create Cognito user: {str(e)}'})

    now = datetime.utcnow().isoformat() + 'Z'
    users_table.put_item(Item={
        'email': emp_email,
        'orgId': org_id,
        'role': 'employee',
        'displayName': display_name or emp_email.split('@')[0],
        'createdAt': now
    })

    return respond(201, {
        'email': emp_email,
        'orgId': org_id,
        'role': 'employee',
        'displayName': display_name or emp_email.split('@')[0],
        'tempPassword': temp_password,
        'message': 'Employee created successfully'
    })

def delete_employee(event):
    org_id = event['pathParameters']['orgId']
    emp_email = event['pathParameters']['email']
    email = get_user_email(event)

    if not email:
        return respond(401, {'error': 'Unauthorized'})

    caller = get_user_record(email)
    if not caller or caller['orgId'] != org_id or caller['role'] != 'admin':
        return respond(403, {'error': 'Admin access required'})

    emp = get_user_record(emp_email)
    if not emp or emp['orgId'] != org_id:
        return respond(404, {'error': 'Employee not found in this organization'})

    if emp['role'] == 'admin':
        return respond(400, {'error': 'Cannot delete admin user'})

    try:
        cognito.admin_disable_user(
            UserPoolId=USER_POOL_ID,
            Username=emp_email
        )
    except Exception:
        pass

    users_table.delete_item(Key={'email': emp_email})

    return respond(200, {'message': f'Employee {emp_email} removed'})

def lambda_handler(event, context):
    method = event['httpMethod']
    resource = event.get('resource', '')

    if method == 'OPTIONS':
        return respond(200, {})

    if resource == '/auth/me' and method == 'GET':
        return get_me(event)
    elif method == 'GET' and 'employees' in resource and '{email}' not in resource:
        return list_employees(event)
    elif method == 'POST' and 'employees' in resource:
        return create_employee(event)
    elif method == 'DELETE' and 'employees' in resource:
        return delete_employee(event)
    else:
        return respond(404, {'error': 'Not found'})
