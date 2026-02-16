#!/bin/bash
set -e
REGION="us-east-2"
ACCOUNT_ID="584973764297"
POOL_ID="us-east-2_Hv31RDYP0"

echo "=== Creating API Gateway ==="

# Create REST API
API_ID=$(aws apigateway create-rest-api \
  --name EEmployee_API \
  --description "E-Employee API" \
  --endpoint-configuration '{"types":["REGIONAL"]}' \
  --region $REGION \
  --query 'id' --output text)

echo "API ID: $API_ID"

# Get root resource ID
ROOT_ID=$(aws apigateway get-resources \
  --rest-api-id $API_ID \
  --region $REGION \
  --query 'items[?path==`/`].id' --output text)

echo "Root Resource ID: $ROOT_ID"

# Create Cognito Authorizer
AUTH_ID=$(aws apigateway create-authorizer \
  --rest-api-id $API_ID \
  --name CognitoAuth \
  --type COGNITO_USER_POOLS \
  --provider-arns "arn:aws:cognito-idp:${REGION}:${ACCOUNT_ID}:userpool/${POOL_ID}" \
  --identity-source 'method.request.header.Authorization' \
  --region $REGION \
  --query 'id' --output text)

echo "Authorizer ID: $AUTH_ID"

# Helper function to create a resource
create_resource() {
  local PARENT_ID=$1
  local PATH_PART=$2
  aws apigateway create-resource \
    --rest-api-id $API_ID \
    --parent-id $PARENT_ID \
    --path-part "$PATH_PART" \
    --region $REGION \
    --query 'id' --output text
}

# Helper: create method + integration + CORS
setup_method() {
  local RESOURCE_ID=$1
  local HTTP_METHOD=$2
  local LAMBDA_NAME=$3

  # Create method with Cognito auth
  aws apigateway put-method \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method $HTTP_METHOD \
    --authorization-type COGNITO_USER_POOLS \
    --authorizer-id $AUTH_ID \
    --region $REGION > /dev/null

  # Lambda integration
  aws apigateway put-integration \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method $HTTP_METHOD \
    --type AWS_PROXY \
    --integration-http-method POST \
    --uri "arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${LAMBDA_NAME}/invocations" \
    --region $REGION > /dev/null

  echo "  $HTTP_METHOD -> $LAMBDA_NAME"
}

# Helper: add OPTIONS (CORS) to a resource
setup_cors() {
  local RESOURCE_ID=$1

  aws apigateway put-method \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method OPTIONS \
    --authorization-type NONE \
    --region $REGION > /dev/null

  aws apigateway put-integration \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method OPTIONS \
    --type MOCK \
    --request-templates '{"application/json": "{\"statusCode\": 200}"}' \
    --region $REGION > /dev/null

  aws apigateway put-method-response \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method OPTIONS \
    --status-code 200 \
    --response-parameters '{"method.response.header.Access-Control-Allow-Headers":true,"method.response.header.Access-Control-Allow-Methods":true,"method.response.header.Access-Control-Allow-Origin":true}' \
    --region $REGION > /dev/null

  aws apigateway put-integration-response \
    --rest-api-id $API_ID \
    --resource-id $RESOURCE_ID \
    --http-method OPTIONS \
    --status-code 200 \
    --response-parameters '{"method.response.header.Access-Control-Allow-Headers":"'"'"'Content-Type,Authorization'"'"'","method.response.header.Access-Control-Allow-Methods":"'"'"'GET,POST,PUT,DELETE,OPTIONS'"'"'","method.response.header.Access-Control-Allow-Origin":"'"'"'*'"'"'"}' \
    --region $REGION > /dev/null
}

# ---- Create Resources ----
echo "Creating API resources..."

# /auth
AUTH_RES=$(create_resource $ROOT_ID "auth")
# /auth/me
AUTH_ME_RES=$(create_resource $AUTH_RES "me")

# /organizations
ORGS_RES=$(create_resource $ROOT_ID "organizations")
# /organizations/{orgId}
ORG_RES=$(create_resource $ORGS_RES "{orgId}")
# /organizations/{orgId}/employees
EMPS_RES=$(create_resource $ORG_RES "employees")
# /organizations/{orgId}/employees/{email}
EMP_RES=$(create_resource $EMPS_RES "{email}")
# /organizations/{orgId}/inventory
INV_RES=$(create_resource $ORG_RES "inventory")
# /organizations/{orgId}/inventory/alerts
ALERTS_RES=$(create_resource $INV_RES "alerts")
# /organizations/{orgId}/inventory/{itemId}
ITEM_RES=$(create_resource $INV_RES "{itemId}")

echo "Resources created."

# ---- Setup Methods ----
echo "Setting up methods..."

echo "/auth/me:"
setup_method $AUTH_ME_RES GET EEmployee_Users
setup_cors $AUTH_ME_RES

echo "/organizations:"
setup_method $ORGS_RES POST EEmployee_Organizations
setup_cors $ORGS_RES

echo "/organizations/{orgId}:"
setup_method $ORG_RES GET EEmployee_Organizations
setup_method $ORG_RES PUT EEmployee_Organizations
setup_cors $ORG_RES

echo "/organizations/{orgId}/employees:"
setup_method $EMPS_RES GET EEmployee_Users
setup_method $EMPS_RES POST EEmployee_Users
setup_cors $EMPS_RES

echo "/organizations/{orgId}/employees/{email}:"
setup_method $EMP_RES DELETE EEmployee_Users
setup_cors $EMP_RES

echo "/organizations/{orgId}/inventory:"
setup_method $INV_RES GET EEmployee_Inventory
setup_method $INV_RES POST EEmployee_Inventory
setup_cors $INV_RES

echo "/organizations/{orgId}/inventory/alerts:"
setup_method $ALERTS_RES GET EEmployee_Inventory
setup_cors $ALERTS_RES

echo "/organizations/{orgId}/inventory/{itemId}:"
setup_method $ITEM_RES PUT EEmployee_Inventory
setup_method $ITEM_RES DELETE EEmployee_Inventory
setup_cors $ITEM_RES

echo "Methods configured."

# ---- Lambda Permissions ----
echo "Adding Lambda invoke permissions for API Gateway..."

for FUNC in EEmployee_Organizations EEmployee_Users EEmployee_Inventory; do
  aws lambda add-permission \
    --function-name $FUNC \
    --statement-id apigateway-invoke-$(date +%s)-$RANDOM \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*" \
    --region $REGION > /dev/null 2>&1
  echo "  $FUNC permission added"
done

# ---- Deploy ----
echo "Deploying API..."

aws apigateway create-deployment \
  --rest-api-id $API_ID \
  --stage-name prod \
  --region $REGION > /dev/null

API_URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com/prod"

echo ""
echo "=== API Gateway Setup Complete ==="
echo "API ID: $API_ID"
echo "API URL: $API_URL"
echo ""
echo "Save this for frontend config!"
