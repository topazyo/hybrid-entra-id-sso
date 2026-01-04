# Hybrid Entra ID SSO Setup Guide

## Prerequisites

- Node.js 16+ and npm (verified from package.json)
- PowerShell 7+ (verified from scripts/setup/*.ps1)
- Azure Subscription with Global Administrator access (verified from scripts/setup/Initialize-AzureResources.ps1)
- Access to mainframe system for RACF integration (verified from scripts/setup/Initialize-MainframeIntegration.ps1)

## Installation Steps

### 1. Clone and Configure Repository

```bash
# Clone the repository
git clone https://github.com/topazyo/hybrid-entra-id-sso.git
cd hybrid-entra-id-sso

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your settings
```

### 2. Build and Run

```bash
npm run build
npm start
```

### 3. Azure Resources Setup

Run the infrastructure deployment script:

```powershell
./scripts/setup/Initialize-AzureResources.ps1 `
    -TenantId "your-tenant-id" `
    -SubscriptionId "your-subscription-id" `
    -ResourceGroup "your-resource-group"
```

### 4. Configure Azure AD Connect

1. Open Azure AD Connect configuration
2. Enable custom synchronization rules
3. Configure attribute mappings:

```json
{
  "userPrincipalName": "mail",
  "displayName": "displayName",
  "mail": "mail",
  "department": "department"
}
```

### 4. Set Up Mainframe Integration

1. Configure RACF connection settings in `.env`:

```env
MAINFRAME_HOST=your-mainframe-host
MAINFRAME_PORT=23
MAINFRAME_PROTOCOL=TN3270E
MAINFRAME_SSL=true
```

2. Configure the mainframe health probe (required in production when health checks are enabled):

```env
MAINFRAME_HEALTHCHECK_ENABLED=true
MAINFRAME_HEALTHCHECK_URL=https://your-mainframe-host.example.com/health
MAINFRAME_HEALTHCHECK_METHOD=HEAD
MAINFRAME_HEALTHCHECK_EXPECTED_STATUSES=200,204,301,302,307,308
MAINFRAME_HEALTHCHECK_TIMEOUT_MS=3000
MAINFRAME_SESSION_TTL_SECONDS=300
MAINFRAME_SESSION_IDLE_SECONDS=900
```

- When `MAINFRAME_HEALTHCHECK_ENABLED` is true in production, set `MAINFRAME_HEALTHCHECK_URL` (or inject a custom probe) to avoid startup errors.
- Use `HEAD` for lightweight checks; switch to `GET` if your endpoint requires a body.
- Adjust `MAINFRAME_SESSION_TTL_SECONDS` and `MAINFRAME_SESSION_IDLE_SECONDS` to match your mainframe session policies.

2. Run RACF integration setup:

```powershell
./scripts/setup/Initialize-MainframeIntegration.ps1 `
    -MainframeHost $env:MAINFRAME_HOST `
    -MainframePort $env:MAINFRAME_PORT
```

### 5. Configure Monitoring

1. Set up Log Analytics workspace:

```powershell
./scripts/setup/Initialize-Monitoring.ps1 `
    -WorkspaceName "your-workspace" `
    -ResourceGroup "your-resource-group"
```

2. Configure monitoring settings in `.env`:

```env
LOG_ANALYTICS_WORKSPACE_ID=your-workspace-id
LOG_ANALYTICS_KEY=your-workspace-key
ALERT_WEBHOOK_URL=your-webhook-url
```

### 6. Security Configuration

1. Generate certificates:

```bash
./scripts/security/Generate-Certificates.ps1 `
    -CertPath "./certificates" `
    -CommonName "your-domain.com"
```

2. Configure security settings:

```env
JWT_SECRET=your-jwt-secret
ENCRYPTION_KEY=your-encryption-key
MFA_ENABLED=true
```

## Configuration

Environment variables from `.env.example`. Load via [`ConfigurationManager`](src/services/ConfigurationManager.ts) with `APP_` prefix. Sensitive keys (matching patterns like /secret/i) are not exposed via `/config/:key`.

| Variable | Required | Default | Description | Where Used |
|----------|----------|---------|-------------|------------|
| AZURE_TENANT_ID | Yes | - | Azure Tenant ID | scripts/setup/*.ps1, src/integrations/AzureMonitorIntegration.ts |
| AZURE_CLIENT_ID | Yes | - | Azure Client ID | scripts/setup/*.ps1 |
| AZURE_CLIENT_SECRET | Yes | - | Azure Client Secret | scripts/setup/*.ps1 |
| LOG_ANALYTICS_WORKSPACE_ID | Yes | - | Log Analytics Workspace ID | src/services/AuditLogger.ts, scripts/monitoring/Monitor-EntraIDHealth.ps1 |
| LOG_ANALYTICS_KEY | Yes | - | Log Analytics Key | src/services/AuditLogger.ts, scripts/monitoring/Monitor-EntraIDHealth.ps1 |
| MAINFRAME_HOST | Yes (for mainframe integration) | - | Mainframe hostname/IP | scripts/setup/Initialize-MainframeIntegration.ps1, src/services/RacfIntegrationService.ts |
| MAINFRAME_PORT | Yes (for mainframe integration) | - | Mainframe port | scripts/setup/Initialize-MainframeIntegration.ps1 |
| TOKEN_LIFETIME_MINUTES | No | 60 | Access token lifetime | src/services/AccessTokenService.ts |
| MFA_ENABLED | No | true | Enable MFA | src/services/AdaptiveMFAService.ts |
| ENCRYPTION_ALGORITHM | No | AES-256-GCM | Encryption algorithm | src/types/config.ts |

## Verification Steps

1. Run tests:
```bash
npm test
```

2. Check health endpoint:
```bash
curl http://localhost:3000/health
```

3. Generate compliance report:
```powershell
./scripts/compliance/Generate-ComplianceReport.ps1
```

## Troubleshooting

### Common Issues

1. **Sync Failures**
   - Check Azure AD Connect service status
   - Verify network connectivity
   - Review sync logs in Event Viewer

2. **Mainframe Connection Issues**
   - Verify RACF credentials
   - Check network routing
   - Confirm SSL certificate validity

3. **Monitoring Alerts**
   - Verify Log Analytics agent installation
   - Check workspace connection
   - Confirm alert rules configuration

### Support

For additional support:
- Open an issue in the repository
- Contact the security team
- Review logs in Azure Monitor