#!/bin/bash
set -e
REGION="us-east-2"
ACCOUNT_ID="584973764297"

echo "=== E-Employee Infrastructure Setup ==="

# ---- Step 1: IAM Roles ----
echo "Creating IAM roles..."

# Lambda basic execution role
ASSUME_ROLE_POLICY='{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}'

aws iam create-role \
  --role-name EEmployee_LambdaRole \
  --assume-role-policy-document "$ASSUME_ROLE_POLICY" \
  --region $REGION 2>/dev/null || echo "Role EEmployee_LambdaRole already exists"

aws iam attach-role-policy \
  --role-name EEmployee_LambdaRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole \
  --region $REGION 2>/dev/null || true

# DynamoDB + Cognito full access for the main Lambda role
DYNAMO_COGNITO_POLICY='{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "dynamodb:*",
      "Resource": "arn:aws:dynamodb:us-east-2:584973764297:table/EEmployee_*"
    },
    {
      "Effect": "Allow",
      "Action": "cognito-idp:*",
      "Resource": "*"
    }
  ]
}'

aws iam put-role-policy \
  --role-name EEmployee_LambdaRole \
  --policy-name EEmployee_DynamoCognitoAccess \
  --policy-document "$DYNAMO_COGNITO_POLICY" \
  --region $REGION

echo "IAM roles created."

# ---- Step 2: DynamoDB Tables ----
echo "Creating DynamoDB tables..."

aws dynamodb create-table \
  --table-name EEmployee_Organizations \
  --attribute-definitions \
    AttributeName=orgId,AttributeType=S \
    AttributeName=domain,AttributeType=S \
  --key-schema AttributeName=orgId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes '[{
    "IndexName": "domain-index",
    "KeySchema": [{"AttributeName": "domain", "KeyType": "HASH"}],
    "Projection": {"ProjectionType": "ALL"}
  }]' \
  --region $REGION 2>/dev/null || echo "Table EEmployee_Organizations already exists"

aws dynamodb create-table \
  --table-name EEmployee_Users \
  --attribute-definitions \
    AttributeName=email,AttributeType=S \
    AttributeName=orgId,AttributeType=S \
  --key-schema AttributeName=email,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes '[{
    "IndexName": "orgId-index",
    "KeySchema": [{"AttributeName": "orgId", "KeyType": "HASH"}],
    "Projection": {"ProjectionType": "ALL"}
  }]' \
  --region $REGION 2>/dev/null || echo "Table EEmployee_Users already exists"

aws dynamodb create-table \
  --table-name EEmployee_Inventory \
  --attribute-definitions \
    AttributeName=orgId,AttributeType=S \
    AttributeName=itemId,AttributeType=S \
  --key-schema \
    AttributeName=orgId,KeyType=HASH \
    AttributeName=itemId,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region $REGION 2>/dev/null || echo "Table EEmployee_Inventory already exists"

echo "DynamoDB tables created."

# ---- Step 3: Lambda - Auto Confirm ----
echo "Creating Auto Confirm Lambda..."

cd /Users/henryoverbeeke/coding/E-contact/backend/lambda/auto-confirm
zip -j /tmp/auto-confirm.zip index.py

aws lambda create-function \
  --function-name EEmployee_AutoConfirm \
  --runtime python3.13 \
  --handler index.lambda_handler \
  --role "arn:aws:iam::${ACCOUNT_ID}:role/EEmployee_LambdaRole" \
  --zip-file fileb:///tmp/auto-confirm.zip \
  --region $REGION 2>/dev/null || \
aws lambda update-function-code \
  --function-name EEmployee_AutoConfirm \
  --zip-file fileb:///tmp/auto-confirm.zip \
  --region $REGION

echo "Auto Confirm Lambda ready."

# ---- Step 4: Cognito User Pool ----
echo "Creating Cognito User Pool..."

POOL_ID=$(aws cognito-idp create-user-pool \
  --pool-name EEmployee_UserPool \
  --auto-verified-attributes email \
  --username-attributes email \
  --policies '{"PasswordPolicy":{"MinimumLength":8,"RequireUppercase":true,"RequireLowercase":true,"RequireNumbers":true,"RequireSymbols":false}}' \
  --lambda-config "{\"PreSignUp\":\"arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:EEmployee_AutoConfirm\"}" \
  --schema '[{"Name":"email","Required":true,"Mutable":true}]' \
  --region $REGION \
  --query 'UserPool.Id' \
  --output text 2>/dev/null) || true

if [ -z "$POOL_ID" ]; then
  echo "User pool may already exist, looking it up..."
  POOL_ID=$(aws cognito-idp list-user-pools --max-results 20 --region $REGION \
    --query "UserPools[?Name=='EEmployee_UserPool'].Id" --output text)
fi

echo "User Pool ID: $POOL_ID"

# Allow Cognito to invoke the auto-confirm Lambda
aws lambda add-permission \
  --function-name EEmployee_AutoConfirm \
  --statement-id CognitoInvoke \
  --action lambda:InvokeFunction \
  --principal cognito-idp.amazonaws.com \
  --source-arn "arn:aws:cognito-idp:${REGION}:${ACCOUNT_ID}:userpool/${POOL_ID}" \
  --region $REGION 2>/dev/null || echo "Permission already exists"

# Create app client
CLIENT_ID=$(aws cognito-idp create-user-pool-client \
  --user-pool-id "$POOL_ID" \
  --client-name EEmployee_WebClient \
  --no-generate-secret \
  --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_SRP_AUTH \
  --region $REGION \
  --query 'UserPoolClient.ClientId' \
  --output text 2>/dev/null) || true

if [ -z "$CLIENT_ID" ]; then
  echo "Client may already exist, looking it up..."
  CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id "$POOL_ID" --region $REGION \
    --query "UserPoolClients[?ClientName=='EEmployee_WebClient'].ClientId" --output text)
fi

echo "Client ID: $CLIENT_ID"

# ---- Step 5: Deploy remaining Lambdas ----
echo "Deploying Lambda functions..."

# Wait for role to propagate
sleep 5

# Organizations Lambda
cd /Users/henryoverbeeke/coding/E-contact/backend/lambda/organizations
zip -j /tmp/organizations.zip index.py

aws lambda create-function \
  --function-name EEmployee_Organizations \
  --runtime python3.13 \
  --handler index.lambda_handler \
  --role "arn:aws:iam::${ACCOUNT_ID}:role/EEmployee_LambdaRole" \
  --zip-file fileb:///tmp/organizations.zip \
  --timeout 30 \
  --region $REGION 2>/dev/null || \
aws lambda update-function-code \
  --function-name EEmployee_Organizations \
  --zip-file fileb:///tmp/organizations.zip \
  --region $REGION

# Users Lambda
cd /Users/henryoverbeeke/coding/E-contact/backend/lambda/users
zip -j /tmp/users.zip index.py

aws lambda create-function \
  --function-name EEmployee_Users \
  --runtime python3.13 \
  --handler index.lambda_handler \
  --role "arn:aws:iam::${ACCOUNT_ID}:role/EEmployee_LambdaRole" \
  --zip-file fileb:///tmp/users.zip \
  --timeout 30 \
  --environment "{\"Variables\":{\"USER_POOL_ID\":\"${POOL_ID}\"}}" \
  --region $REGION 2>/dev/null || \
aws lambda update-function-code \
  --function-name EEmployee_Users \
  --zip-file fileb:///tmp/users.zip \
  --region $REGION

# Inventory Lambda
cd /Users/henryoverbeeke/coding/E-contact/backend/lambda/inventory
zip -j /tmp/inventory.zip index.py

aws lambda create-function \
  --function-name EEmployee_Inventory \
  --runtime python3.13 \
  --handler index.lambda_handler \
  --role "arn:aws:iam::${ACCOUNT_ID}:role/EEmployee_LambdaRole" \
  --zip-file fileb:///tmp/inventory.zip \
  --timeout 30 \
  --region $REGION 2>/dev/null || \
aws lambda update-function-code \
  --function-name EEmployee_Inventory \
  --zip-file fileb:///tmp/inventory.zip \
  --region $REGION

echo ""
echo "=== Infrastructure Setup Complete ==="
echo "User Pool ID: $POOL_ID"
echo "Client ID: $CLIENT_ID"
echo ""
echo "Save these values for the frontend config!"
