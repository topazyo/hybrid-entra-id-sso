# Hybrid Entra ID SSO Integration Suite

Enterprise-grade solution for implementing and managing Hybrid Entra ID SSO in complex environments with legacy system integration. Bridges Azure Entra ID with mainframe auth via Express/TypeScript runtime.

## Features

- **HTTP API Surface**: Routes for health checks (`/health`), config access (`/config/:key`), mainframe data (`/api/v1/mainframe/data`), and token auth (`/auth/token`).
- **Authentication Chain**: Modular providers including RACF password auth ([`RacfPasswordProvider`](src/auth/RacfPasswordProvider.ts)) and bearer token auth ([`BearerTokenAuthProvider`](src/auth/BearerTokenAuthProvider.ts)).
- **Security Controls**: Rate limiting ([`RateLimiter`](src/services/RateLimiter.ts)), audit logging ([`AuditLogger`](src/services/AuditLogger.ts)), and security headers middleware ([`securityHeadersMiddleware`](src/middleware/SecurityHeadersMiddleware.ts)).
- **Monitoring & Alerting**: Real-time monitoring pipeline ([`MonitoringPipeline`](src/monitoring/MonitoringPipeline.ts)), identity sync monitor ([`IdentitySyncMonitor`](src/monitoring/IdentitySyncMonitor.ts)), and Azure Monitor integration ([`AzureMonitorIntegration`](src/integrations/AzureMonitorIntegration.ts)).
- **Compliance Reporting**: Automated reports via PowerShell scripts ([`Generate-ComplianceReport.ps1`](scripts/compliance/Generate-ComplianceReport.ps1)) and TypeScript services ([`ComplianceMonitor`](src/services/ComplianceMonitor.ts)).

## Prerequisites

- Node.js 16+ and npm (verified from package.json)
- PowerShell 7+ (verified from scripts/setup/*.ps1)
- Azure Subscription with Global Administrator access (verified from scripts/setup/Initialize-AzureResources.ps1)
- Access to mainframe system for RACF integration (verified from scripts/setup/Initialize-MainframeIntegration.ps1)

## Quick Start

1. Clone the repository:
```bash
git clone https://github.com/topazyo/hybrid-entra-id-sso.git
cd hybrid-entra-id-sso
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment:
```bash
cp [`.env.example`](.env.example ) .env
# Edit .env with your settings
```

4. Build and run:
```bash
npm run build
npm start
```

5. Run setup scripts (optional, for full deployment):
```powershell
[`scripts/setup/initialize.ps1`](scripts/setup/initialize.ps1 ) -TenantId "your-tenant-id" -SubscriptionId "your-subscription-id" -ResourceGroup "your-resource-group"
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

## Usage

- **Development server**: `npm start` (ts-node src/index.ts)
- **Build**: `npm run build` (tsc to dist/)
- **Production**: `npm run start:prod` (node dist/index.js after build)
- **Tests**: `npm test` (Jest)
- **Setup Azure resources**: `./scripts/setup/Initialize-AzureResources.ps1 -TenantId "id" -SubscriptionId "id" -ResourceGroupName "rg"`
- **Setup monitoring**: `./scripts/setup/Initialize-Monitoring.ps1 -WorkspaceName "ws" -ResourceGroupName "rg"`
- **Health check**: Hit `/health` endpoint
- **Compliance report**: `./scripts/compliance/Generate-ComplianceReport.ps1`

## Project Structure

- **`/config`**: Infrastructure templates (Bicep for Azure, Kubernetes manifests).
- **`/docs`**: Documentation (architecture, setup, monitoring).
- **`/examples`**: Sample scripts (PowerShell, TypeScript).
- **`/scripts`**: Automation (setup, monitoring, compliance, security, sync).
- **`/src`**: Core TypeScript code (auth, controllers, integrations, middleware, monitoring, security, services).
- **`/tests`**: Jest tests.
- **`/utils`**: Helpers.
- **Root files**: package.json, tsconfig.json, jest.config.js, Dockerfile, .env.example.

## CI/CD

GitHub Actions workflow ([`.github/workflows/security-pipeline.yml`](.github/workflows/security-pipeline.yml)) handles build, test, lint, security scans (Snyk, Trivy), and deployment to AKS on main branch pushes.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See security best practices in [docs/architecture/security-components.md](docs/architecture/security-components.md).

## License

MIT License - see [LICENSE](LICENSE) for details.