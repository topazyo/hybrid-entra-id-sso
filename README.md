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