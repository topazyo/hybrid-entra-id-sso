# Architecture Overview

This document provides a detailed overview of the Hybrid Entra ID SSO Integration Suite's architecture.

## Core Components

The suite is composed of several key components that work together to provide seamless and secure single sign-on (SSO) capabilities in a hybrid environment involving Microsoft Entra ID and legacy mainframe systems.

1.  **Identity Synchronization Monitor (`src/monitoring/IdentitySyncMonitor.ts`, `scripts/monitoring/Monitor-EntraIDHealth.ps1`)**:
    *   Responsible for continuously monitoring the health and status of identity synchronization processes between on-premises Active Directory and Azure Entra ID via Azure AD Connect.
    *   It also includes scripts to check Entra ID health more broadly.

2.  **Mainframe Integration Layer (`src/integrations/MainframeIntegrationLayer.ts`, `src/middleware/MainframeAuthBridge.ts`)**:
    *   Provides the services and middleware necessary to bridge modern authentication protocols (like SAML, OAuth 2.0) with legacy mainframe authentication systems (e.g., RACF).
    *   Manages session translation and secure communication with the mainframe.

3.  **Risk-Based Access Policy Engine (`src/security/PolicyEnforcementEngine.ts`, `src/security/RiskBasedPolicyEngine.ts`, `src/services/AdaptiveAccessControl.ts`)**:
    *   A sophisticated engine that dynamically assesses the risk associated with an authentication request.
    *   Factors considered include user behavior, device trust, location, and threat intelligence.
    *   Enforces adaptive access control policies, potentially requiring step-up authentication (MFA) or blocking access if the risk is too high.

4.  **Real-time Monitoring and Alerting (`src/monitoring/MonitoringPipeline.ts`, `src/services/AlertService.ts`, `src/integrations/AzureMonitorIntegration.ts`)**:
    *   A comprehensive pipeline for collecting, processing, and analyzing security events and operational metrics from all components.
    *   Integrates with Azure Monitor for log aggregation, dashboards, and automated alerting on suspicious activities or system failures.

5.  **Compliance Reporting (`scripts/compliance/Generate-ComplianceReport.ps1`, `src/services/ComplianceMonitor.ts`)**:
    *   Tools and services to automate the generation of compliance reports (e.g., for GDPR, HIPAA, SOX).
    *   Monitors system configurations and user access patterns against defined compliance policies.

6.  **Authentication Chain (`src/auth/AuthenticationChain.ts`, `src/services/AuthenticationChain.ts`)**:
    *   Orchestrates the authentication process by allowing multiple authentication providers or steps to be chained together.
    *   This allows for flexible and complex authentication workflows, such as integrating different MFA providers or custom pre-authentication checks.

7.  **Security Orchestrator (`src/services/SecurityOrchestrator.ts`)**:
    *   Acts as a central coordinator for various security services, including threat detection, incident response, and policy enforcement.
    *   It helps in streamlining security operations and ensuring a cohesive security posture.

## High-Level Flow

1.  A user attempts to access an application integrated with the Hybrid Entra ID SSO solution.
2.  The request is intercepted by the **Mainframe Auth Bridge** or a similar entry point.
3.  The **Authentication Chain** is invoked to process the authentication request.
4.  The **Risk-Based Access Policy Engine** assesses the risk of the request.
5.  Based on the risk score and configured policies, the user might be prompted for MFA (via **AdaptiveMFAService**), granted access, or denied.
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
