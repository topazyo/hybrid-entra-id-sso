// src/middleware/SecurityHeadersMiddleware.ts
import { Request, Response, NextFunction } from 'express';

export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Sets X-Content-Type-Options to prevent browsers from MIME-sniffing a response away from the declared content-type.
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Sets X-Frame-Options to indicate whether a browser should be allowed to render a page in a <frame>, <iframe>, <embed> or <object>.
  // 'DENY' - no rendering within a frame.
  // 'SAMEORIGIN' - allow if frame is from the same origin.
  res.setHeader('X-Frame-Options', 'DENY');

  // Sets Strict-Transport-Security to tell browsers to prefer HTTPS and to remember it.
  // max-age is in seconds. includeSubDomains is optional.
  // Only send HSTS header if the connection is secure (HTTPS) or if explicitly configured for development behind a TLS-terminating proxy.
  // For this example, we'll assume a config flag or req.secure check.
  // Let's simplify for now and always set it, but in prod, req.secure is important.
  // if (req.secure || process.env.NODE_ENV === 'development_with_proxy_ssl') { // More robust check
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // }

  // Sets X-XSS-Protection to enable the XSS filtering in browsers.
  // '1; mode=block' - enable XSS filtering and prevent rendering if an attack is detected.
  // Note: Modern browsers often have their own XSS protection, and CSP is generally preferred.
  // Some security advisors recommend disabling it (X-XSS-Protection: 0) if you have a strong CSP.
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Content Security Policy (CSP) - very basic example.
  // A real CSP would be much more detailed and specific to the application's needs.
  // Example: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
  // For a simple API, a restrictive policy is good.
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; form-action 'self';");

  // Referrer-Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions-Policy (Feature-Policy) - Example: disable microphone and geolocation
  res.setHeader('Permissions-Policy', 'microphone=(), geolocation=()');

  next();
}
