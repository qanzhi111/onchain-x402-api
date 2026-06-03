#!/bin/bash
# x402 API Deployment Script
# Usage: GITHUB_TOKEN=ghp_xxx ./deploy.sh

set -e

TOKEN=${GITHUB_TOKEN:?"Please set GITHUB_TOKEN"}
REPO="x402-crypto-api"
OWNER="onchain-shadow"
API="https://api.github.com"

echo "Creating GitHub repository..."
curl -s -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  $API/user/repos \
  -d "{\"name\":\"$REPO\",\"description\":\"Pay-per-request crypto data API using x402 protocol - USDC on Base\",\"private\":false,\"auto_init\":false}"

echo ""
echo "Pushing code via GitHub API..."

# Upload each file using the Contents API
upload_file() {
  local path=$1
  local local_path=$2
  local content=$(base64 -w 0 "$local_path")
  
  echo "  Uploading $path..."
  curl -s -X PUT \
    -H "Authorization: token $TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    $API/repos/$OWNER/$REPO/contents/$path \
    -d "{\"message\":\"Add $path\",\"content\":\"$content\"}" | jq -r '.content.path // .message'
}

upload_file "server.js" "./server.js"
upload_file "package.json" "./package.json"
upload_file "README.md" "./README.md"
upload_file ".gitignore" "./.gitignore"
upload_file ".env.example" "./.env.example"

echo ""
echo "Done! Repository: https://github.com/$OWNER/$REPO"
