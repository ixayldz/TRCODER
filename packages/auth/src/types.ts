/**
 * Auth Types
 */

export interface User {
    id: string;
    email: string;
    name?: string;
    avatar_url?: string;
    provider: "email" | "google" | "github";
    provider_id?: string;
    password_hash?: string;
    email_verified: boolean;
    created_at: string;
    updated_at: string;
}

export interface Organization {
    id: string;
    name: string;
    slug: string;
    owner_id: string;
    plan_id: string;
    credits_balance: number;
    credits_included: number;
    billing_email?: string;
    stripe_customer_id?: string;
    stripe_subscription_id?: string;
    created_at: string;
    updated_at: string;
}

export interface OrgMember {
    org_id: string;
    user_id: string;
    role: "owner" | "admin" | "member";
    joined_at: string;
}

export interface ApiKey {
    id: string;
    key_hash: string;
    key_prefix: string;
    name: string;
    org_id: string;
    user_id: string;
    scopes: string[];
    last_used_at?: string;
    expires_at?: string;
    created_at: string;
    revoked_at?: string;
}

export interface Session {
    id: string;
    user_id: string;
    org_id: string;
    token_hash: string;
    ip_address?: string;
    user_agent?: string;
    expires_at: string;
    created_at: string;
}

export interface JwtPayload {
    sub: string;        // user_id
    org: string;        // org_id
    email: string;
    role: string;
    iat: number;
    exp: number;
}

export interface AuthResult {
    user: User;
    org: Organization;
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
}

export interface ApiKeyResult {
    id: string;
    key: string;         // Full key (only shown once)
    key_prefix: string;  // For display: trc_live_abc...
    name: string;
    scopes: string[];
    created_at: string;
    expires_at?: string;
}

export type AuthProvider = "email" | "google" | "github";

export interface OAuthProfile {
    provider: AuthProvider;
    provider_id: string;
    email: string;
    name?: string;
    avatar_url?: string;
}

// Scopes for API keys
export const API_KEY_SCOPES = {
    "runs:read": "Read run status and history",
    "runs:write": "Start and manage runs",
    "projects:read": "Read project information",
    "projects:write": "Create and manage projects",
    "billing:read": "View usage and billing",
    "admin": "Full administrative access"
} as const;

export type ApiKeyScope = keyof typeof API_KEY_SCOPES;
