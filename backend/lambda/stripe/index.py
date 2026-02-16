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
        'tier2CheckoutUrl': os.environ.get('STRIPE_TIER2_URL', ''),
        'infrastructureCheckoutUrl': os.environ.get('STRIPE_INFRA_URL', ''),
        'extraStoreCheckoutUrl': os.environ.get('STRIPE_EXTRA_STORE_URL', '')
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

    if tier not in ('tier1', 'tier2', 'infrastructure'):
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

    # Cancel at end of billing period on Stripe
    result = stripe_request('POST', f'/subscriptions/{sub_id}', {
        'cancel_at_period_end': 'true'
    })

    if 'error' in result:
        return respond(400, {'error': result['error'].get('message', 'Cancel failed')})

    # Mark cancellation pending in DynamoDB
    orgs_table.update_item(
        Key={'orgId': user['orgId']},
        UpdateExpression='SET stripeCancelPending = :cp',
        ExpressionAttributeValues={':cp': True}
    )

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

    # Clear cancellation pending flag in DynamoDB
    orgs_table.update_item(
        Key={'orgId': user['orgId']},
        UpdateExpression='REMOVE stripeCancelPending'
    )

    return respond(200, {'message': 'Subscription reactivated', 'cancelAtPeriodEnd': False})


def handle_lookup(event):
    """Look up a Stripe customer by the admin's own email and link their subscription to the org."""
    email = get_user_email(event)
    if not email:
        return respond(401, {'error': 'Unauthorized'})

    user = get_user_org(email)
    if not user or user.get('role') != 'admin':
        return respond(403, {'error': 'Admin access required'})

    # Only allow looking up the admin's own email -- no spoofing
    stripe_email = email

    # Search Stripe for customers with this email
    encoded_email = urllib.parse.quote(stripe_email)
    customers = stripe_request('GET', f'/customers?email={encoded_email}&limit=1')

    if 'error' in customers:
        return respond(400, {'error': customers['error'].get('message', 'Stripe lookup failed')})

    data = customers.get('data', [])
    if not data:
        return respond(404, {'error': 'No Stripe customer found with that email'})

    customer = data[0]
    customer_id = customer['id']

    # Find active subscriptions for this customer
    subs = stripe_request('GET', f'/subscriptions?customer={customer_id}&limit=5')

    if 'error' in subs:
        return respond(400, {'error': subs['error'].get('message', 'Failed to fetch subscriptions')})

    sub_list = subs.get('data', [])
    if not sub_list:
        return respond(404, {'error': 'No subscriptions found for that customer'})

    # Pick the first active/trialing/past_due subscription
    active_sub = None
    for s in sub_list:
        if s.get('status') in ('active', 'trialing', 'past_due'):
            active_sub = s
            break

    if not active_sub:
        active_sub = sub_list[0]

    sub_id = active_sub['id']

    # Determine tier from the subscription (check product metadata or price)
    # For now, keep the org's current tier or default to tier1
    org_resp = orgs_table.get_item(Key={'orgId': user['orgId']})
    org = org_resp.get('Item', {})
    current_tier = org.get('tier', 'none')
    if current_tier == 'none':
        current_tier = 'tier1'

    # Link the subscription to the org
    orgs_table.update_item(
        Key={'orgId': user['orgId']},
        UpdateExpression='SET stripeCustomerId = :c, stripeSubscriptionId = :s, tier = :t',
        ExpressionAttributeValues={
            ':c': customer_id,
            ':s': sub_id,
            ':t': current_tier
        }
    )

    return respond(200, {
        'customerId': customer_id,
        'subscriptionId': sub_id,
        'status': active_sub.get('status', 'unknown'),
        'tier': current_tier,
        'cancelAtPeriodEnd': active_sub.get('cancel_at_period_end', False),
        'currentPeriodEnd': active_sub.get('current_period_end')
    })


def handle_add_store(event):
    """Link an extra store subscription to the org."""
    email = get_user_email(event)
    if not email:
        return respond(401, {'error': 'Unauthorized'})

    user = get_user_org(email)
    if not user or user.get('role') != 'admin':
        return respond(403, {'error': 'Admin access required'})

    body = json.loads(event.get('body', '{}'))
    session_id = body.get('sessionId', '')

    org_resp = orgs_table.get_item(Key={'orgId': user['orgId']})
    org = org_resp.get('Item', {})

    if org.get('tier') != 'infrastructure':
        return respond(400, {'error': 'Infrastructure plan required'})

    sub_id = ''
    if session_id:
        session = stripe_request('GET', f'/checkout/sessions/{session_id}')
        if 'error' not in session:
            sub_id = session.get('subscription', '')

    extra_subs = org.get('extraStoreSubIds', [])
    if not isinstance(extra_subs, list):
        extra_subs = []

    if sub_id and sub_id not in extra_subs:
        extra_subs.append(sub_id)

    orgs_table.update_item(
        Key={'orgId': user['orgId']},
        UpdateExpression='SET extraStoreSubIds = :e',
        ExpressionAttributeValues={':e': extra_subs}
    )

    return respond(200, {
        'message': 'Extra store add-on linked',
        'extraStoreCount': len(extra_subs)
    })


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

    # POST /stripe/lookup
    if method == 'POST' and path.endswith('/stripe/lookup'):
        return handle_lookup(event)

    # POST /stripe/add-store
    if method == 'POST' and path.endswith('/stripe/add-store'):
        return handle_add_store(event)

    return respond(404, {'error': 'Not found'})
