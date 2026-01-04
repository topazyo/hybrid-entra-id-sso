# Architecture Overview

This document provides a detailed overview of the Hybrid Entra ID SSO Integration Suite's architecture.

## Core Components

The suite is composed of several key components that work together to provide seamless and secure single sign-on (SSO) capabilities in a hybrid environment involving Microsoft Entra ID and legacy mainframe systems.

1.  **HTTP API Surface**:
    *   Routes defined in [`src/index.ts`](src/index.ts): `/health` (health checks), `/config/:key` (config access with restrictions), `/api/v1/mainframe/data` (protected mainframe data), `/auth/token` (token issuance).
    *   All routes protected by rate limiting, audit logging, and security headers middleware.

2.  **Authentication Chain** ([`src/auth/AuthenticationChain.ts`](src/auth/AuthenticationChain.ts)):
    *   Orchestrates authentication with modular providers: [`RacfPasswordProvider`](src/auth/RacfPasswordProvider.ts) for mainframe RACF auth and [`BearerTokenAuthProvider`](src/auth/BearerTokenAuthProvider.ts) for access tokens.
    *   Supports flexible workflows for complex authentication scenarios.

3.  **Identity Synchronization Monitor** ([`src/monitoring/IdentitySyncMonitor.ts`](src/monitoring/IdentitySyncMonitor.ts), [`scripts/monitoring/Monitor-EntraIDHealth.ps1`](scripts/monitoring/Monitor-EntraIDHealth.ps1)):
    *   Monitors health and status of identity synchronization between on-premises Active Directory and Azure Entra ID via Azure AD Connect.
    *   Includes scripts to check Entra ID health more broadly.

4.  **Mainframe Integration Layer** ([`src/integrations/MainframeIntegrationLayer.ts`](src/integrations/MainframeIntegrationLayer.ts), [`src/middleware/MainframeAuthBridge.ts`](src/middleware/MainframeAuthBridge.ts)):
    *   Bridges modern protocols (SAML, OAuth 2.0) with legacy mainframe auth (e.g., RACF).
    *   Manages session translation and secure communication with the mainframe.

5.  **Risk-Based Access Policy Engine** ([`src/security/PolicyEnforcementEngine.ts`](src/security/PolicyEnforcementEngine.ts), [`src/security/RiskBasedPolicyEngine.ts`](src/security/RiskBasedPolicyEngine.ts), [`src/services/AdaptiveAccessControl.ts`](src/services/AdaptiveAccessControl.ts)):
    *   Dynamically assesses risk based on user behavior, device trust, location, and threat intelligence.
    *   Enforces adaptive policies, potentially requiring MFA or blocking access.

6.  **Real-time Monitoring and Alerting** ([`src/monitoring/MonitoringPipeline.ts`](src/monitoring/MonitoringPipeline.ts), [`src/services/AlertService.ts`](src/services/AlertService.ts), [`src/integrations/AzureMonitorIntegration.ts`](src/integrations/AzureMonitorIntegration.ts)):
    *   Pipeline for collecting, processing, and analyzing security events and metrics.
    *   Integrates with Azure Monitor for log aggregation, dashboards, and automated alerting.

7.  **Compliance Reporting** ([`scripts/compliance/Generate-ComplianceReport.ps1`](scripts/compliance/Generate-ComplianceReport.ps1), [`src/services/ComplianceMonitor.ts`](src/services/ComplianceMonitor.ts)):
    *   Automates generation of compliance reports (e.g., GDPR, HIPAA, SOX).
    *   Monitors configurations and access patterns against policies.

8.  **Security Orchestrator** ([`src/services/SecurityOrchestrator.ts`](src/services/SecurityOrchestrator.ts)):
    *   Central coordinator for threat detection, incident response, and policy enforcement.
    *   Ensures cohesive security posture.

## High-Level Flow

1.  A user or system accesses the HTTP API surface (e.g., `/auth/token` for token issuance, `/api/v1/mainframe/data` for protected data).
2.  Requests are processed through global middleware: security headers, audit logging, and rate limiting.
3.  For authentication routes, the **Authentication Chain** is invoked with providers like RACF password or bearer token auth.
4.  The **Risk-Based Access Policy Engine** assesses the risk of the request.
5.  Based on the risk score and policies, the user might be prompted for MFA (via **AdaptiveMFAService**), granted access, or denied.
6.  For mainframe access, the **Mainframe Integration Layer** translates the modern identity token into a format understood by the mainframe.
7.  All significant events are logged and monitored by the **Real-time Monitoring and Alerting** components.
8.  The **Identity Synchronization Monitor** continuously checks the sync status between on-prem AD and Entra ID.
9.  **Compliance Reports** can be generated on-demand or scheduled.

## Key Technologies (Assumed)

*   **Node.js & TypeScript**: For the backend services and integration logic.
*   **PowerShell**: For automation scripts (setup, monitoring, compliance).
*   **Azure Entra ID**: Core identity provider.
*   **Azure Monitor**: For logging, monitoring, and alerting.
*   **Mainframe (with RACF or similar)**: Legacy system to integrate with.
*   **SAML, OAuth 2.0, OpenID Connect**: Standard authentication and authorization protocols.

This overview will be expanded with more detailed diagrams and component interactions as the project evolves.
