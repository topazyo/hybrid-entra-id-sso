# Hybrid Entra ID SSO Integration Suite

Enterprise-grade solution for implementing and managing Hybrid Entra ID SSO in complex environments with legacy system integration.

## Features

- Custom Identity Synchronization Monitor
- Mainframe Integration Layer
- Risk-Based Access Policy Engine
- Real-time Monitoring and Alerting
- Compliance Reporting

## Prerequisites

- Azure AD Connect
- Node.js 16+
- PowerShell 7+
- Azure Subscription
- Mainframe access (for legacy integration)

## Quick Start

1. Clone the repository:
```bash
git clone https://github.com/your-org/hybrid-entra-id-sso.git
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment:
```bash
cp .env.example .env
# Edit .env with your settings
```

4. Run setup script:
```bash
./scripts/setup/initialize.ps1
```

## Documentation

- [Architecture Overview](docs/architecture/README.md)
- [Setup Guide](docs/setup/README.md)
- [Monitoring Guide](docs/monitoring/README.md)

## Security

This project implements enterprise security best practices including:

- Secure credential handling
- Audit logging
- Compliance monitoring
- Risk-based authentication

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Project Structure

The repository is organized into the following main directories:

*   **`/config`**: Contains configuration files, including infrastructure-as-code templates (e.g., Bicep for Azure) and Kubernetes manifests.
    *   `/config/infrastructure`: Azure resource definitions.
    *   `/config/kubernetes`: Kubernetes deployment configurations.
*   **`/docs`**: Houses all project documentation.
    *   `/docs/architecture`: Detailed architecture diagrams and explanations.
    *   `/docs/monitoring`: Guides on monitoring the system.
    *   `/docs/setup`: Installation and setup instructions.
*   **`/examples`**: Contains example scripts and code snippets for using or integrating with the suite.
    *   `/examples/powershell`: PowerShell examples.
    *   `/examples/typescript`: TypeScript examples.
*   **`/scripts`**: Includes automation scripts for various tasks like setup, compliance, monitoring, and security.
    *   `/scripts/compliance`: Compliance report generation.
    *   `/scripts/database`: Database schema management (if applicable).
    *   `/scripts/monitoring`: Scripts for health checks and monitoring tasks.
    *   `/scripts/security`: Security assessment and certificate management.
    *   `/scripts/setup`: System initialization and setup scripts.
    *   `/scripts/sync`: Identity synchronization scripts.
*   **`/src`**: Contains the core source code for the application, written primarily in TypeScript.
    *   `/src/auth`: Authentication-related components, including providers and chains.
    *   `/src/controllers`: API controllers for handling incoming requests.
    *   `/src/integrations`: Modules for integrating with external systems (Azure Monitor, Mainframe).
    *   `/src/middleware`: Custom middleware for request processing (auditing, auth bridging, rate limiting).
    *   `/src/monitoring`: Components for system monitoring and health checks.
    *   `/src/processors`: Event processors and data handling logic.
    *   `/src/security`: Security-specific logic, including policy enforcement and risk engines.
    *   `/src/services`: Core business logic and services (alerting, caching, threat detection, etc.).
    *   `/src/types`: TypeScript type definitions and interfaces.
*   **`/tests`**: Contains all test files.
    *   `/tests/services`: Service-level tests.
    *   `/tests/unit`: Unit tests for individual modules and functions.
*   **`/utils`**: Utility functions and helper modules.

## Key Technologies Used

This project leverages a combination of modern and enterprise technologies to achieve its goals:

*   **Node.js & TypeScript**: The primary backend technology for building robust and scalable services.
*   **PowerShell**: Used for automation scripting, especially for Azure and Windows-based environments.
*   **Microsoft Entra ID (Azure AD)**: The core cloud identity provider.
*   **Azure Cloud Services**:
    *   **Azure Monitor (Log Analytics, Application Insights)**: For comprehensive monitoring, logging, and alerting.
    *   **Azure Key Vault**: For secure management of secrets and cryptographic keys.
    *   **Azure Functions / App Service**: Potential hosting environments for backend services.
    *   **Azure Storage**: For storing logs, artifacts, or other data.
*   **Mainframe Technologies (e.g., RACF)**: The legacy systems with which this suite integrates.
*   **Authentication Protocols**: SAML, OAuth 2.0, OpenID Connect for modern authentication. TN3270 or similar for mainframe interactions.
*   **Infrastructure-as-Code**: Bicep (`/config/infrastructure`) for defining Azure resources declaratively.
*   **Containerization (Optional but common)**: Docker and Kubernetes (`/config/kubernetes`) for deployment and orchestration, though not explicitly detailed in all scripts yet.
*   **Security Best Practices**:
    *   Risk-Based Authentication.
    *   Adaptive Multi-Factor Authentication (MFA).
    *   Audit Logging.
    *   Secure Credential Management.
    *   Compliance Monitoring.