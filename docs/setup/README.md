# Hybrid Entra ID SSO Setup Guide

## Prerequisites

- Azure Subscription with Global Administrator access
- Azure AD Connect installed and configured
- Node.js 16+ and npm
- PowerShell 7+
- Access to mainframe system (for RACF integration)

## Installation Steps

### 1. Clone and Configure Repository

```bash
# Clone the repository
git clone https://github.com/your-org/hybrid-entra-id-sso.git
cd hybrid-entra-id-sso

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

### 2. Azure Resources Setup

Run the infrastructure deployment script:

```powershell
./scripts/setup/Initialize-AzureResources.ps1 `
    -TenantId "your-tenant-id" `
    -SubscriptionId "your-subscription-id" `
    -ResourceGroup "your-resource-group"
```

### 3. Configure Azure AD Connect

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

## Verification Steps

1. Run health check:
```bash
npm run health-check
```

2. Test SSO integration:
```bash
npm run test:integration
```

3. Verify monitoring:
```bash
npm run verify-monitoring
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