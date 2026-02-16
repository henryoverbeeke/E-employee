import json
import os
import urllib.request
import urllib.parse
import boto3

STRIPE_SECRET_KEY = os.environ.get('STRIPE_SECRET_KEY', '')
STRIPE_PUBLISHABLE_KEY = os.environ.get('STRIPE_PUBLISHABLE_KEY', '')
dynamodb = boto3.resource('dynamodb', region_name='us-east-2')
orgs_table = dynamodb.Table('EEmployee_Organizations')
users_table = dynamodb.Table('EEmployee_Users')

STRIPE_API = 'https://api.stripe.com/v1'


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


def stripe_request(method, endpoint, data=None):
    """Make an authenticated request to the Stripe API."""
    url = f'{STRIPE_API}{endpoint}'
    encoded = None
    if data:
        encoded = urllib.parse.urlencode(data).encode()

    req = urllib.request.Request(url, data=encoded, method=method)
    req.add_header('Authorization', f'Bearer {STRIPE_SECRET_KEY}')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')

    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        try:
            return json.loads(error_body)
        except Exception:
            return {'error': {'message': error_body}}


def handle_config(event):
    """Return public Stripe config to the frontend -- no secrets exposed."""
    return respond(200, {
        'publishableKey': STRIPE_PUBLISHABLE_KEY,
        'tier1CheckoutUrl': os.environ.get('STRIPE_TIER1_URL', ''),
        'tier2CheckoutUrl': os.environ.get('STRIPE_TIER2_URL', '')
    })


def handle_activate(event):
    """Called after Stripe Checkout -- retrieves session, stores subscription info on org."""
    email = get_user_email(event)
    if not email:
        return respond(401, {'error': 'Unauthorized'})

    user = get_user_org(email)
    if not user or user.get('role') != 'admin':
        return respond(403, {'error': 'Admin access required'})

    body = json.loads(event.get('body', '{}'))
    session_id = body.get('sessionId')
    tier = body.get('tier')

    if not session_id or not tier:
        return respond(400, {'error': 'sessionId and tier are required'})

    if tier not in ('tier1', 'tier2'):
        return respond(400, {'error': 'Invalid tier'})

    # Retrieve the checkout session from Stripe
    session = stripe_request('GET', f'/checkout/sessions/{session_id}')
    if 'error' in session:
        return respond(400, {'error': session['error'].get('message', 'Failed to retrieve session')})

    customer_id = session.get('customer', '')
    subscription_id = session.get('subscription', '')

    # Update org with Stripe info and tier
    orgs_table.update_item(
        Key={'orgId': user['orgId']},
        UpdateExpression='SET tier = :t, stripeCustomerId = :c, stripeSubscriptionId = :s',
        ExpressionAttributeValues={
            ':t': tier,
            ':c': customer_id,
            ':s': subscription_id
        }
    )

    return respond(200, {
        'tier': tier,
        'customerId': customer_id,
        'subscriptionId': subscription_id
    })


def handle_get_subscription(event):
    """Get the org's current Stripe subscription details."""
    email = get_user_email(event)
    if not email:
        return respond(401, {'error': 'Unauthorized'})

    user = get_user_org(email)
    if not user:
        return respond(403, {'error': 'User not found'})

    org_resp = orgs_table.get_item(Key={'orgId': user['orgId']})
    org = org_resp.get('Item', {})

    tier = org.get('tier', 'none')
    sub_id = org.get('stripeSubscriptionId', '')

    result = {
        'tier': tier,
        'subscriptionId': sub_id,
        'status': 'none'
    }

    if sub_id:
        sub = stripe_request('GET', f'/subscriptions/{sub_id}')
        if 'error' not in sub:
            result['status'] = sub.get('status', 'unknown')
            result['currentPeriodEnd'] = sub.get('current_period_end')
            result['cancelAtPeriodEnd'] = sub.get('cancel_at_period_end', False)

    return respond(200, result)


def handle_cancel(event):
    """Cancel the org's subscription at period end."""
    email = get_user_email(event)
    if not email:
        return respond(401, {'error': 'Unauthorized'})

    user = get_user_org(email)
    if not user or user.get('role') != 'admin':
        return respond(403, {'error': 'Admin access required'})

    org_resp = orgs_table.get_item(Key={'orgId': user['orgId']})
    org = org_resp.get('Item', {})
    sub_id = org.get('stripeSubscriptionId', '')

    if not sub_id:
        return respond(400, {'error': 'No active subscription'})

    # Cancel at end of billing period
    result = stripe_request('POST', f'/subscriptions/{sub_id}', {
        'cancel_at_period_end': 'true'
    })

    if 'error' in result:
        return respond(400, {'error': result['error'].get('message', 'Cancel failed')})

    return respond(200, {
        'message': 'Subscription will cancel at end of billing period',
        'cancelAtPeriodEnd': True
    })


def handle_reactivate(event):
    """Reactivate a subscription that was set to cancel."""
    email = get_user_email(event)
    if not email:
        return respond(401, {'error': 'Unauthorized'})

    user = get_user_org(email)
    if not user or user.get('role') != 'admin':
        return respond(403, {'error': 'Admin access required'})

    org_resp = orgs_table.get_item(Key={'orgId': user['orgId']})
    org = org_resp.get('Item', {})
    sub_id = org.get('stripeSubscriptionId', '')

    if not sub_id:
        return respond(400, {'error': 'No active subscription'})

    result = stripe_request('POST', f'/subscriptions/{sub_id}', {
        'cancel_at_period_end': 'false'
    })

    if 'error' in result:
        return respond(400, {'error': result['error'].get('message', 'Reactivate failed')})

    return respond(200, {'message': 'Subscription reactivated', 'cancelAtPeriodEnd': False})


def handle_cancel_immediately(event):
    """Cancel immediately and remove tier."""
    email = get_user_email(event)
    if not email:
        return respond(401, {'error': 'Unauthorized'})

    user = get_user_org(email)
    if not user or user.get('role') != 'admin':
        return respond(403, {'error': 'Admin access required'})

    org_resp = orgs_table.get_item(Key={'orgId': user['orgId']})
    org = org_resp.get('Item', {})
    sub_id = org.get('stripeSubscriptionId', '')

    if sub_id:
        stripe_request('DELETE', f'/subscriptions/{sub_id}')

    # Remove tier and Stripe info
    orgs_table.update_item(
        Key={'orgId': user['orgId']},
        UpdateExpression='SET tier = :t REMOVE stripeCustomerId, stripeSubscriptionId',
        ExpressionAttributeValues={':t': 'none'}
    )

    return respond(200, {'message': 'Subscription cancelled and tier removed'})


def lambda_handler(event, context):
    method = event.get('httpMethod', '')
    resource = event.get('resource', '')
    path = event.get('path', '')

    if method == 'OPTIONS':
        return respond(200, {})

    # GET /stripe/config (public keys + checkout URLs)
    if method == 'GET' and path.endswith('/stripe/config'):
        return handle_config(event)

    # POST /stripe/activate
    if method == 'POST' and path.endswith('/stripe/activate'):
        return handle_activate(event)

    # GET /stripe/subscription
    if method == 'GET' and path.endswith('/stripe/subscription'):
        return handle_get_subscription(event)

    # POST /stripe/cancel
    if method == 'POST' and path.endswith('/stripe/cancel'):
        return handle_cancel(event)

    # POST /stripe/reactivate
    if method == 'POST' and path.endswith('/stripe/reactivate'):
        return handle_reactivate(event)

    # POST /stripe/cancel-now
    if method == 'POST' and path.endswith('/stripe/cancel-now'):
        return handle_cancel_immediately(event)

    return respond(404, {'error': 'Not found'})
