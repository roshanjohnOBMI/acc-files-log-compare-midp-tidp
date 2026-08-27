#!/usr/bin/env bash
# Provisions the Azure resources described in the deployment blueprint:
# resource group, Linux App Service Plan (B2), Web App (Node 20), Key Vault + secrets,
# Application Insights, and the production hardening flags (Always On, HTTPS Only, TLS 1.2).
#
# This script is NOT run automatically - review the variables below, then run it yourself with
# `az login` already done: `bash deploy/azure-provision.sh`
#
# It is safe to re-run: every `az ... create` call here is idempotent (updates in place if the
# resource already exists) rather than failing or duplicating.

set -euo pipefail

# ---- Variables - edit these ----
RESOURCE_GROUP="rg-accfilelog-prod"
LOCATION="eastus"                      # az account list-locations -o table
PLAN_NAME="plan-accfilelog-prod"
PLAN_SKU="B2"                          # 2 vCPU / 3.5 GB - see blueprint section 03 for sizing
WEBAPP_NAME="acc-filelog-compare"      # must be globally unique - becomes <name>.azurewebsites.net
KEYVAULT_NAME="kv-accfilelog-prod"     # must be globally unique, 3-24 chars
APPINSIGHTS_NAME="appi-accfilelog-prod"

# Secrets - fill these in before running, or export them in your shell first.
APS_CLIENT_ID="${APS_CLIENT_ID:?Set APS_CLIENT_ID before running}"
APS_CLIENT_SECRET="${APS_CLIENT_SECRET:?Set APS_CLIENT_SECRET before running}"
SESSION_SECRET="${SESSION_SECRET:?Set SESSION_SECRET before running (any long random string)}"

# Set once the custom domain (or default *.azurewebsites.net hostname) is decided.
PRODUCTION_URL="https://${WEBAPP_NAME}.azurewebsites.net"

# ---- Resource group ----
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION"

# ---- App Service Plan (Linux) ----
az appservice plan create \
  --name "$PLAN_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --is-linux \
  --sku "$PLAN_SKU"

# ---- Web App (Node 20, single instance) ----
az webapp create \
  --name "$WEBAPP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --plan "$PLAN_NAME" \
  --runtime "NODE:20-lts"

# System-assigned managed identity, used below for Key Vault access.
az webapp identity assign \
  --name "$WEBAPP_NAME" \
  --resource-group "$RESOURCE_GROUP"
PRINCIPAL_ID=$(az webapp identity show \
  --name "$WEBAPP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query principalId -o tsv)

# ---- Key Vault + secrets ----
az keyvault create \
  --name "$KEYVAULT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --enable-rbac-authorization true

az keyvault secret set --vault-name "$KEYVAULT_NAME" --name "aps-client-secret" --value "$APS_CLIENT_SECRET" >/dev/null
az keyvault secret set --vault-name "$KEYVAULT_NAME" --name "session-secret" --value "$SESSION_SECRET" >/dev/null

VAULT_ID=$(az keyvault show --name "$KEYVAULT_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)
az role assignment create \
  --role "Key Vault Secrets User" \
  --assignee-object-id "$PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --scope "$VAULT_ID"

# ---- Application Insights ----
az monitor app-insights component create \
  --app "$APPINSIGHTS_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --application-type web
INSTRUMENTATION_KEY=$(az monitor app-insights component show \
  --app "$APPINSIGHTS_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query instrumentationKey -o tsv)

# ---- App Settings ----
# SCM_DO_BUILD_DURING_DEPLOYMENT=true lets Azure's Oryx builder run `npm install` + `npm run build`
# (both workspaces) server-side after the GitHub Actions workflow pushes the raw source - keeps the
# build logic in one place instead of duplicating it in CI.
az webapp config appsettings set \
  --name "$WEBAPP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    NODE_ENV="production" \
    SCM_DO_BUILD_DURING_DEPLOYMENT="true" \
    APS_CLIENT_ID="$APS_CLIENT_ID" \
    APS_CALLBACK_URL="${PRODUCTION_URL}/api/auth/callback" \
    CLIENT_URL="$PRODUCTION_URL" \
    APPLICATIONINSIGHTS_CONNECTION_STRING="InstrumentationKey=${INSTRUMENTATION_KEY}" \
    APS_CLIENT_SECRET="@Microsoft.KeyVault(VaultName=${KEYVAULT_NAME};SecretName=aps-client-secret)" \
    SESSION_SECRET="@Microsoft.KeyVault(VaultName=${KEYVAULT_NAME};SecretName=session-secret)"

# ---- Production hardening ----
az webapp config set \
  --name "$WEBAPP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --always-on true \
  --min-tls-version "1.2"

az webapp update \
  --name "$WEBAPP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --https-only true

echo
echo "Done. Web App URL: $PRODUCTION_URL"
echo
echo "Next steps:"
echo "  1. Add ${PRODUCTION_URL}/api/auth/callback as an additional redirect URI on the APS app"
echo "     at https://aps.autodesk.com."
echo "  2. Grab the publish profile for the GitHub Actions workflow and store it as the"
echo "     AZURE_WEBAPP_PUBLISH_PROFILE secret in the GitHub repo:"
echo "       az webapp deployment list-publishing-profiles --name $WEBAPP_NAME --resource-group $RESOURCE_GROUP --xml"
echo "  3. (Optional) Attach a custom domain, then request the free managed certificate:"
echo "       az webapp config hostname add --webapp-name $WEBAPP_NAME --resource-group $RESOURCE_GROUP --hostname <your-domain>"
echo "       az webapp config ssl create --resource-group $RESOURCE_GROUP --name $WEBAPP_NAME --hostname <your-domain>"
