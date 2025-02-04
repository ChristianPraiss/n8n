import type { Application, Request } from 'express';
import jwt from 'jsonwebtoken';
import jwks from 'jwks-rsa';
import type { Config } from '@/config';
import { jwtAuthAuthorizationError } from '@/ResponseHelper';
import { LoggerProxy as Logger } from 'n8n-workflow';

export const setupExternalJWTAuth = async (
	app: Application,
	config: Config,
	authIgnoreRegex: RegExp,
) => {
	const jwtAuthHeader = config.getEnv('security.jwtAuth.jwtHeader');
	const jwtAuthCookie = config.getEnv('security.jwtAuth.jwtCookie');
	if (jwtAuthHeader === '' && jwtAuthCookie === '') {
		throw new Error(
			'JWT auth is activated but no request header or cookie was defined. Please set one!',
		);
	}

	const jwksUri = config.getEnv('security.jwtAuth.jwksUri');
	if (jwksUri === '') {
		throw new Error('JWT auth is activated but no JWK Set URI was defined. Please set one!');
	}

	const jwtHeaderValuePrefix = config.getEnv('security.jwtAuth.jwtHeaderValuePrefix');
	const jwtIssuer = config.getEnv('security.jwtAuth.jwtIssuer');
	const jwtNamespace = config.getEnv('security.jwtAuth.jwtNamespace');
	const jwtAllowedTenantKey = config.getEnv('security.jwtAuth.jwtAllowedTenantKey');
	const jwtAllowedTenant = config.getEnv('security.jwtAuth.jwtAllowedTenant');

	// eslint-disable-next-line no-inner-declarations
	function isTenantAllowed(decodedToken: object): boolean {
		if (jwtNamespace === '' || jwtAllowedTenantKey === '' || jwtAllowedTenant === '') {
			return true;
		}

		for (const [k, v] of Object.entries(decodedToken)) {
			if (k === jwtNamespace) {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
				for (const [kn, kv] of Object.entries(v)) {
					if (kn === jwtAllowedTenantKey && kv === jwtAllowedTenant) {
						return true;
					}
				}
			}
		}

		return false;
	}
	// eslint-disable-next-line consistent-return
	app.use((req: Request, res, next) => {
		if (authIgnoreRegex.exec(req.url)) {
			return next();
		}

		let token = jwtAuthHeader
			? req.header(jwtAuthHeader)
			: // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
			  (req.cookies?.[jwtAuthCookie] as string | undefined);

		if (token === undefined || token === '') {
			return jwtAuthAuthorizationError(res, 'Missing token');
		}

		if (jwtHeaderValuePrefix !== '' && token.startsWith(jwtHeaderValuePrefix)) {
			token = token.replace(`${jwtHeaderValuePrefix} `, '').trimStart();
		}

		const jwkClient = jwks({ cache: true, jwksUri });
		const getKey: jwt.GetPublicKeyOrSecret = (header, callbackFn) => {
			// eslint-disable-next-line @typescript-eslint/no-throw-literal
			if (!header.kid) throw jwtAuthAuthorizationError(res, 'No JWT key found');
			jwkClient.getSigningKey(header.kid, (error, key) => {
				// eslint-disable-next-line @typescript-eslint/no-throw-literal
				if (error) callbackFn(error);
				callbackFn(null, key?.getPublicKey());
			});
		};

		const jwtVerifyOptions: jwt.VerifyOptions = {
			issuer: jwtIssuer !== '' ? jwtIssuer : undefined,
			ignoreExpiration: false,
		};

		jwt.verify(token, getKey, jwtVerifyOptions, (error: jwt.VerifyErrors, decoded: object) => {
			if (error) {
				jwtAuthAuthorizationError(res, 'Invalid token: ' + error.message);
			} else if (!isTenantAllowed(decoded)) {
				jwtAuthAuthorizationError(res, 'Tenant not allowed');
			} else {
				next();
			}
		});
	});
};
