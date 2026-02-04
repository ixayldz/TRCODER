/**
 * JWT Token Management
 */

import jwt from "jsonwebtoken";
import { JwtPayload } from "./types";

const DEFAULT_ACCESS_TOKEN_EXPIRY = "1h";
const DEFAULT_REFRESH_TOKEN_EXPIRY = "7d";

export interface TokenConfig {
    secret: string;
    accessTokenExpiry?: string;
    refreshTokenExpiry?: string;
    issuer?: string;
    audience?: string;
}

export class TokenManager {
    private config: Required<TokenConfig>;

    constructor(config: TokenConfig) {
        this.config = {
            accessTokenExpiry: DEFAULT_ACCESS_TOKEN_EXPIRY,
            refreshTokenExpiry: DEFAULT_REFRESH_TOKEN_EXPIRY,
            issuer: "trcoder",
            audience: "trcoder-api",
            ...config
        };
    }

    static fromEnv(): TokenManager {
        const secret = process.env.TRCODER_JWT_SECRET;
        if (!secret) {
            throw new Error("TRCODER_JWT_SECRET environment variable is required");
        }
        return new TokenManager({
            secret,
            accessTokenExpiry: process.env.TRCODER_ACCESS_TOKEN_EXPIRY,
            refreshTokenExpiry: process.env.TRCODER_REFRESH_TOKEN_EXPIRY,
            issuer: process.env.TRCODER_JWT_ISSUER,
            audience: process.env.TRCODER_JWT_AUDIENCE
        });
    }

    generateAccessToken(payload: Omit<JwtPayload, "iat" | "exp">): string {
        const signOptions: jwt.SignOptions = {
            expiresIn: this.config.accessTokenExpiry as jwt.SignOptions["expiresIn"],
            issuer: this.config.issuer,
            audience: this.config.audience
        };
        return jwt.sign(payload as object, this.config.secret, signOptions);
    }

    generateRefreshToken(userId: string): string {
        const signOptions: jwt.SignOptions = {
            expiresIn: this.config.refreshTokenExpiry as jwt.SignOptions["expiresIn"],
            issuer: this.config.issuer
        };
        return jwt.sign(
            { sub: userId, type: "refresh" },
            this.config.secret,
            signOptions
        );
    }

    verifyAccessToken(token: string): JwtPayload {
        try {
            const decoded = jwt.verify(token, this.config.secret, {
                issuer: this.config.issuer,
                audience: this.config.audience
            });
            return decoded as JwtPayload;
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                throw new AuthError("Token expired", "TOKEN_EXPIRED");
            }
            if (error instanceof jwt.JsonWebTokenError) {
                throw new AuthError("Invalid token", "INVALID_TOKEN");
            }
            throw error;
        }
    }

    verifyRefreshToken(token: string): { sub: string; type: string } {
        try {
            const decoded = jwt.verify(token, this.config.secret, {
                issuer: this.config.issuer
            }) as { sub: string; type: string };

            if (decoded.type !== "refresh") {
                throw new AuthError("Invalid token type", "INVALID_TOKEN");
            }

            return decoded;
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                throw new AuthError("Refresh token expired", "TOKEN_EXPIRED");
            }
            if (error instanceof jwt.JsonWebTokenError) {
                throw new AuthError("Invalid refresh token", "INVALID_TOKEN");
            }
            throw error;
        }
    }

    decodeToken(token: string): JwtPayload | null {
        try {
            return jwt.decode(token) as JwtPayload;
        } catch (err: unknown) {
            // Token decode is non-critical, return null silently
            return null;
        }
    }

    getAccessTokenExpiry(): number {
        return parseExpiry(this.config.accessTokenExpiry);
    }
}

function parseExpiry(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 3600; // default 1h

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
        case "s": return value;
        case "m": return value * 60;
        case "h": return value * 3600;
        case "d": return value * 86400;
        default: return 3600;
    }
}

export class AuthError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number = 401
    ) {
        super(message);
        this.name = "AuthError";
    }
}
