import { RacfIntegrationService } from '../../src/services/RacfIntegrationService';
import { SamlMainframeTranslator } from '../../src/services/SamlMainframeTranslator';
import { MainframeSessionManager } from '../../src/services/MainframeSessionManager';

async function demonstrateMainframeIntegration() {
  // Initialize services
  const racfService = new RacfIntegrationService();
  const translator = new SamlMainframeTranslator();
  const sessionManager = new MainframeSessionManager();

  try {
    // Sample SAML assertion
    const samlAssertion = {
      nameID: 'john.doe@example.com',
      attributes: {
        groups: ['AZURE_ADMINS'],
        role: 'admin',
        department: 'IT'
      }
    };

    // Translate SAML to RACF credentials
    console.log('Translating SAML assertion to RACF credentials...');
    const racfCreds = await translator.translateCredentials(samlAssertion);
    console.log('RACF credentials:', racfCreds);

    // Create RACF session
    console.log('Creating RACF session...');
    const racfSession = await racfService.createRacfSession(samlAssertion);
    console.log('RACF session created:', racfSession);

    // Create mainframe session
    console.log('Creating mainframe session...');
    const mainframeSession = await sessionManager.createSession(
      samlAssertion.nameID,
      racfCreds
    );
    console.log('Mainframe session created:', mainframeSession);

    // Validate session
    console.log('Validating session...');
    const isValid = await sessionManager.validateSession(mainframeSession.id);
    console.log('Session validation result:', isValid);

    // Cleanup
    console.log('Cleaning up sessions...');
    await sessionManager.terminateSession(mainframeSession.id, 'demo_cleanup');
    await racfService.terminateSession(racfSession.id, 'demo_cleanup');

  } catch (error) {
    console.error('Mainframe integration demonstration failed:', error);
    throw error;
  }
}

// Run the demonstration
demonstrateMainframeIntegration().catch(console.error);