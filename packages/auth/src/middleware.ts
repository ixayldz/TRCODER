/**
 * Auth Middleware for Fastify
 */

import { ApiKeyManager, parseAuthHeader } from "./api-keys";
import { TokenManager, AuthError } from "./tokens";
import { User, Organization, ApiKey, JwtPayload } from "./types";

export interface AuthContext {
    user?: User;
    org?: Organization;
    apiKey?: ApiKey;
    jwt?: JwtPayload;
    isApiKeyAuth: boolean;
}

export interface AuthMiddlewareConfig {
    tokenManager: TokenManager;
    apiKeyManager: ApiKeyManager;
    getUserById: (id: string) => Promise<User | null>;
    getOrgById: (id: string) => Promise<Organization | null>;
    publicPaths?: string[];
}

export function createAuthMiddleware(config: AuthMiddlewareConfig) {
    const publicPaths = new Set(config.publicPaths ?? [
        "/health",
        "/v1/auth/register",
        "/v1/auth/login",
        "/v1/auth/oauth/*",
        "/v1/auth/refresh"
    ]);

    return async function authMiddleware(
        request: { headers: Record<string, string | string[] | undefined>; url: string },
        reply: { code: (code: number) => { send: (body: unknown) => void } }
    ): Promise<AuthContext | void> {
        // Check if path is public
        const path = request.url.split("?")[0];
        if (isPublicPath(path, publicPaths)) {
            return { isApiKeyAuth: false };
        }

        const authHeader = request.headers.authorization;
        const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
        const { type, token } = parseAuthHeader(headerValue);

        if (!token) {
            reply.code(401).send({
                error: "Unauthorized",
                message: "Missing or invalid authorization header"
            });
            return;
        }

        try {
            if (type === "apikey") {
                // API key authentication
                const result = await config.apiKeyManager.validate(token);
                if (!result.valid || !result.apiKey) {
                    reply.code(401).send({
                        error: "Unauthorized",
                        message: result.error ?? "Invalid API key"
                    });
                    return;
                }

                const org = await config.getOrgById(result.apiKey.org_id);
                if (!org) {
                    reply.code(401).send({
                        error: "Unauthorized",
                        message: "Organization not found"
                    });
                    return;
                }

                return {
                    apiKey: result.apiKey,
                    org,
                    isApiKeyAuth: true
                };

            } else if (type === "bearer") {
                // JWT authentication
                const payload = config.tokenManager.verifyAccessToken(token);

                const user = await config.getUserById(payload.sub);
                if (!user) {
                    reply.code(401).send({
                        error: "Unauthorized",
                        message: "User not found"
                    });
                    return;
                }

                const org = await config.getOrgById(payload.org);
                if (!org) {
                    reply.code(401).send({
                        error: "Unauthorized",
                        message: "Organization not found"
                    });
                    return;
                }

                return {
                    user,
                    org,
                    jwt: payload,
                    isApiKeyAuth: false
                };
            }

            reply.code(401).send({
                error: "Unauthorized",
                message: "Invalid authorization type"
            });

        } catch (error: unknown) {
            if (error instanceof AuthError) {
                reply.code(error.statusCode).send({
                    error: "Unauthorized",
                    message: error.message,
                    code: error.code
                });
                return;
            }
            throw error;
        }
    };
}

function isPublicPath(path: string, publicPaths: Set<string>): boolean {
    if (publicPaths.has(path)) return true;

    // Check wildcard patterns
    for (const pattern of publicPaths) {
        if (pattern.endsWith("/*")) {
            const prefix = pattern.slice(0, -2);
            if (path.startsWith(prefix)) return true;
        }
    }

    return false;
}

/**
 * Require specific API key scopes
 */
export function requireScopes(scopes: string[]) {
    return function scopeMiddleware(
        context: AuthContext,
        reply: { code: (code: number) => { send: (body: unknown) => void } }
    ): boolean {
        if (!context.isApiKeyAuth || !context.apiKey) {
            return true; // JWT auth, no scope check needed
        }

        const hasAllScopes = scopes.every(
            scope => context.apiKey!.scopes.includes(scope) || context.apiKey!.scopes.includes("admin")
        );

        if (!hasAllScopes) {
            reply.code(403).send({
                error: "Forbidden",
                message: `Missing required scopes: ${scopes.join(", ")}`
            });
            return false;
        }

        return true;
    };
}
