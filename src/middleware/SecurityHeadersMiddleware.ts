import { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/Logger';

export class SecurityHeadersMiddleware {
    private logger: Logger;
    private options: SecurityHeadersOptions;

    constructor(options?: Partial<SecurityHeadersOptions>) {
        this.logger = new Logger('SecurityHeadersMiddleware');
        this.options = {
            hsts: true,
            noSniff: true,
            xssProtection: true,
            frameOptions: 'DENY',
            ...options
        };
    }

    middleware = (req: Request, res: Response, next: NextFunction): void => {
        try {
            // Set security headers
            if (this.options.hsts) {
                res.setHeader(
                    'Strict-Transport-Security',
                    'max-age=31536000; includeSubDomains; preload'
                );
            }

            if (this.options.noSniff) {
                res.setHeader('X-Content-Type-Options', 'nosniff');
            }

            if (this.options.xssProtection) {
                res.setHeader('X-XSS-Protection', '1; mode=block');
            }

            res.setHeader('X-Frame-Options', this.options.frameOptions);
            res.setHeader('Content-Security-Policy', this.generateCSP());
            res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
            res.setHeader('Permissions-Policy', this.generatePermissionsPolicy());

            // Add security response headers
            res.on('finish', () => {
                this.logSecurityHeaders(req, res);
            });

            next();
        } catch (error) {
            this.logger.error('Error in security headers middleware', { error });
            next(error);
        }
    };

    private generateCSP(): string {
        return [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "font-src 'self'",
            "connect-src 'self'",
            "media-src 'none'",
            "object-src 'none'",
            "frame-src 'none'",
            "base-uri 'self'",
            "form-action 'self'"
        ].join('; ');
    }

    private generatePermissionsPolicy(): string {
        return [
            'geolocation=()',
            'microphone=()',
            'camera=()',
            'payment=()',
            'usb=()',
            'magnetometer=()',
            'accelerometer=()'
        ].join(', ');
    }

    private logSecurityHeaders(req: Request, res: Response): void {
        this.logger.debug('Security headers applied', {
            path: req.path,
            method: req.method,
            headers: res.getHeaders()
        });
    }
}

interface SecurityHeadersOptions {
    hsts: boolean;
    noSniff: boolean;
    xssProtection: boolean;
    frameOptions: 'DENY' | 'SAMEORIGIN';
}