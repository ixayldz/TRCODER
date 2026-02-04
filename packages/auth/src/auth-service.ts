/**
 * Auth Service - Main authentication service
 */

import { nanoid } from "nanoid";
import { User, Organization, AuthResult, OAuthProfile, OrgMember } from "./types";
import { hashPassword, verifyPassword, validatePassword, validateEmail } from "./password";
import { TokenManager, AuthError } from "./tokens";

export interface UserStore {
    create(user: Omit<User, "id" | "created_at" | "updated_at">): Promise<User>;
    findById(id: string): Promise<User | null>;
    findByEmail(email: string): Promise<User | null>;
    findByProvider(provider: string, providerId: string): Promise<User | null>;
    update(id: string, data: Partial<User>): Promise<User>;
}

export interface OrgStore {
    create(org: Omit<Organization, "id" | "created_at" | "updated_at">): Promise<Organization>;
    findById(id: string): Promise<Organization | null>;
    findBySlug(slug: string): Promise<Organization | null>;
    findByUserId(userId: string): Promise<Organization[]>;
    update(id: string, data: Partial<Organization>): Promise<Organization>;
    addMember(orgId: string, userId: string, role: OrgMember["role"]): Promise<void>;
    getMember(orgId: string, userId: string): Promise<OrgMember | null>;
}

export interface AuthServiceConfig {
    tokenManager: TokenManager;
    userStore: UserStore;
    orgStore: OrgStore;
    defaultPlan?: string;
    defaultCredits?: number;
}

export class AuthService {
    private config: AuthServiceConfig;

    constructor(config: AuthServiceConfig) {
        this.config = {
            defaultPlan: "free",
            defaultCredits: 100,
            ...config
        };
    }

    /**
     * Register a new user with email/password
     */
    async register(data: {
        email: string;
        password: string;
        name?: string;
    }): Promise<AuthResult> {
        // Validate email
        if (!validateEmail(data.email)) {
            throw new AuthError("Invalid email address", "INVALID_EMAIL", 400);
        }

        // Validate password
        const passwordValidation = validatePassword(data.password);
        if (!passwordValidation.valid) {
            throw new AuthError(
                passwordValidation.errors.join(". "),
                "WEAK_PASSWORD",
                400
            );
        }

        // Check if email exists
        const existingUser = await this.config.userStore.findByEmail(data.email);
        if (existingUser) {
            throw new AuthError("Email already registered", "EMAIL_EXISTS", 409);
        }

        // Create user
        const passwordHash = await hashPassword(data.password);
        const user = await this.config.userStore.create({
            email: data.email,
            name: data.name,
            password_hash: passwordHash,
            provider: "email",
            email_verified: false
        });

        // Create default organization
        const org = await this.createDefaultOrg(user);

        // Generate tokens
        return this.generateAuthResult(user, org);
    }

    /**
     * Login with email/password
     */
    async login(email: string, password: string): Promise<AuthResult> {
        const user = await this.config.userStore.findByEmail(email);
        if (!user || !user.password_hash) {
            throw new AuthError("Invalid email or password", "INVALID_CREDENTIALS", 401);
        }

        const validPassword = await verifyPassword(password, user.password_hash);
        if (!validPassword) {
            throw new AuthError("Invalid email or password", "INVALID_CREDENTIALS", 401);
        }

        // Get user's primary organization
        const orgs = await this.config.orgStore.findByUserId(user.id);
        const org = orgs[0];
        if (!org) {
            throw new AuthError("No organization found", "NO_ORGANIZATION", 500);
        }

        return this.generateAuthResult(user, org);
    }

    /**
     * OAuth login/register
     */
    async oauthLogin(profile: OAuthProfile): Promise<AuthResult> {
        // Check if user exists with this provider
        let user = await this.config.userStore.findByProvider(
            profile.provider,
            profile.provider_id
        );

        if (user) {
            // Existing user, just login
            const orgs = await this.config.orgStore.findByUserId(user.id);
            return this.generateAuthResult(user, orgs[0]);
        }

        // Check if email exists (link accounts)
        user = await this.config.userStore.findByEmail(profile.email);
        if (user) {
            // Link OAuth to existing account
            user = await this.config.userStore.update(user.id, {
                provider: profile.provider,
                provider_id: profile.provider_id,
                avatar_url: profile.avatar_url
            });
            const orgs = await this.config.orgStore.findByUserId(user.id);
            return this.generateAuthResult(user, orgs[0]);
        }

        // New user via OAuth
        user = await this.config.userStore.create({
            email: profile.email,
            name: profile.name,
            avatar_url: profile.avatar_url,
            provider: profile.provider,
            provider_id: profile.provider_id,
            email_verified: true  // OAuth emails are verified
        });

        const org = await this.createDefaultOrg(user);
        return this.generateAuthResult(user, org);
    }

    /**
     * Refresh access token
     */
    async refreshToken(refreshToken: string): Promise<AuthResult> {
        const payload = this.config.tokenManager.verifyRefreshToken(refreshToken);

        const user = await this.config.userStore.findById(payload.sub);
        if (!user) {
            throw new AuthError("User not found", "USER_NOT_FOUND", 401);
        }

        const orgs = await this.config.orgStore.findByUserId(user.id);
        return this.generateAuthResult(user, orgs[0]);
    }

    /**
     * Get user from access token
     */
    async getUserFromToken(token: string): Promise<{ user: User; org: Organization }> {
        const payload = this.config.tokenManager.verifyAccessToken(token);

        const user = await this.config.userStore.findById(payload.sub);
        if (!user) {
            throw new AuthError("User not found", "USER_NOT_FOUND", 401);
        }

        const org = await this.config.orgStore.findById(payload.org);
        if (!org) {
            throw new AuthError("Organization not found", "ORG_NOT_FOUND", 401);
        }

        return { user, org };
    }

    /**
     * Switch organization context
     */
    async switchOrg(userId: string, orgId: string): Promise<AuthResult> {
        const user = await this.config.userStore.findById(userId);
        if (!user) {
            throw new AuthError("User not found", "USER_NOT_FOUND", 401);
        }

        const member = await this.config.orgStore.getMember(orgId, userId);
        if (!member) {
            throw new AuthError("Not a member of this organization", "NOT_MEMBER", 403);
        }

        const org = await this.config.orgStore.findById(orgId);
        if (!org) {
            throw new AuthError("Organization not found", "ORG_NOT_FOUND", 404);
        }

        return this.generateAuthResult(user, org, member.role);
    }

    private async createDefaultOrg(user: User): Promise<Organization> {
        const slug = this.generateSlug(user.name || user.email);

        const org = await this.config.orgStore.create({
            name: user.name ? `${user.name}'s Workspace` : "My Workspace",
            slug,
            owner_id: user.id,
            plan_id: this.config.defaultPlan!,
            credits_balance: this.config.defaultCredits!,
            credits_included: this.config.defaultCredits!
        });

        await this.config.orgStore.addMember(org.id, user.id, "owner");
        return org;
    }

    private generateAuthResult(
        user: User,
        org: Organization,
        role: string = "owner"
    ): AuthResult {
        const accessToken = this.config.tokenManager.generateAccessToken({
            sub: user.id,
            org: org.id,
            email: user.email,
            role
        });

        const refreshToken = this.config.tokenManager.generateRefreshToken(user.id);

        return {
            user,
            org,
            accessToken,
            refreshToken,
            expiresIn: this.config.tokenManager.getAccessTokenExpiry()
        };
    }

    private generateSlug(base: string): string {
        const slug = base
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 30);
        return `${slug}-${nanoid(6)}`;
    }
}
