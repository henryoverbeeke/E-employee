import json
import os
import urllib.request
import urllib.parse
import boto3

STRIPE_SECRET_KEY = os.environ.get('STRIPE_SECRET_KEY', '')
dynamodb = boto3.resource('dynamodb', region_name='us-east-2')
orgs_table = dynamodb.Table('EEmployee_Organizations')

STRIPE_API = 'https://api.stripe.com/v1'


def stripe_request(method, endpoint):
    url = f'{STRIPE_API}{endpoint}'
    req = urllib.request.Request(url, method=method)
    req.add_header('Authorization', f'Bearer {STRIPE_SECRET_KEY}')
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        try:
            return json.loads(error_body)
        except Exception:
            return {'error': {'message': error_body}}


def lambda_handler(event, context):
    """
    Scheduled monthly check: scan all orgs with a subscription,
    verify status with Stripe, and revoke tier if payment failed,
    was refunded, or subscription was canceled.
    """
    print('Starting monthly Stripe subscription check...')

    # Scan for all orgs that have a tier set (not 'none')
    scan_params = {
        'FilterExpression': 'tier <> :none AND attribute_exists(stripeSubscriptionId)',
        'ExpressionAttributeValues': {':none': 'none'}
    }

    revoked = []
    checked = 0

    response = orgs_table.scan(**scan_params)
    items = response.get('Items', [])

    # Handle pagination
    while response.get('LastEvaluatedKey'):
        response = orgs_table.scan(**scan_params, ExclusiveStartKey=response['LastEvaluatedKey'])
        items.extend(response.get('Items', []))

    for org in items:
        org_id = org['orgId']
        sub_id = org.get('stripeSubscriptionId', '')
        org_name = org.get('orgName', org_id)

        if not sub_id:
            continue

        checked += 1
        sub = stripe_request('GET', f'/subscriptions/{sub_id}')

        if 'error' in sub:
            print(f'  [{org_name}] Failed to fetch subscription {sub_id}: {sub["error"].get("message", "")}')
            continue

        status = sub.get('status', '')
        # Active statuses that should keep their tier
        # 'active', 'trialing' = good
        # 'past_due' = give them a grace period (keep tier)
        # 'canceled', 'unpaid', 'incomplete_expired' = revoke
        revoke_statuses = {'canceled', 'unpaid', 'incomplete_expired'}

        if status in revoke_statuses:
            print(f'  [{org_name}] Subscription {sub_id} status: {status} -- revoking tier')
            orgs_table.update_item(
                Key={'orgId': org_id},
                UpdateExpression='SET tier = :t REMOVE stripeSubscriptionId, stripeCustomerId',
                ExpressionAttributeValues={':t': 'none'}
            )
            revoked.append({'orgId': org_id, 'orgName': org_name, 'status': status})
        else:
            print(f'  [{org_name}] Subscription {sub_id} status: {status} -- OK')

    # Also check for refunded charges in the last 35 days
    import time
    thirty_five_days_ago = int(time.time()) - (35 * 24 * 60 * 60)
    refund_resp = stripe_request('GET', f'/refunds?limit=100&created[gte]={thirty_five_days_ago}')

    if 'error' not in refund_resp:
        refunds = refund_resp.get('data', [])
        for refund in refunds:
            charge_id = refund.get('charge', '')
            if not charge_id:
                continue

            # Get the charge to find the customer
            charge = stripe_request('GET', f'/charges/{charge_id}')
            if 'error' in charge:
                continue

            customer_id = charge.get('customer', '')
            if not customer_id:
                continue

            # Find org with this customer ID
            scan_resp = orgs_table.scan(
                FilterExpression='stripeCustomerId = :cid',
                ExpressionAttributeValues={':cid': customer_id}
            )
            for org in scan_resp.get('Items', []):
                if org.get('tier', 'none') != 'none':
                    print(f'  [{org.get("orgName", org["orgId"])}] Refund detected -- revoking tier')
                    orgs_table.update_item(
                        Key={'orgId': org['orgId']},
                        UpdateExpression='SET tier = :t REMOVE stripeSubscriptionId, stripeCustomerId',
                        ExpressionAttributeValues={':t': 'none'}
                    )
                    revoked.append({
                        'orgId': org['orgId'],
                        'orgName': org.get('orgName', ''),
                        'reason': 'refund'
                    })

    summary = {
        'checked': checked,
        'revoked': len(revoked),
        'details': revoked
    }
    print(f'Done. Checked {checked} orgs, revoked {len(revoked)}.')
    return summary
