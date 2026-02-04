/**
 * CLI Auth Commands
 * Handles login, logout, and account management
 */

import { SecretStorage, getSecretStorage } from "./keychain";

// Simple output helpers with ANSI colors
const output = {
    info: (msg: string) => console.log(msg),
    success: (msg: string) => console.log(`\x1b[32m✓\x1b[0m ${msg}`),
    error: (msg: string) => console.error(`\x1b[31m✗\x1b[0m ${msg}`),
    warn: (msg: string) => console.warn(`\x1b[33m⚠\x1b[0m ${msg}`),
    highlight: (msg: string) => console.log(`\x1b[36m${msg}\x1b[0m`),
    muted: (msg: string) => console.log(`\x1b[90m${msg}\x1b[0m`)
};

const CONFIG_KEY = "trcoder_auth";
const API_KEY_PREFIX = "trc_";

export interface AuthConfig {
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    userId?: string;
    orgId?: string;
    email?: string;
    serverUrl?: string;
}

export class AuthManager {
    private secrets: SecretStorage | null = null;
    private serverUrl: string;

    constructor(serverUrl?: string) {
        this.serverUrl = serverUrl ?? process.env.TRCODER_SERVER_URL ?? "https://api.trcoder.io";
    }

    private async getSecrets(): Promise<SecretStorage> {
        if (!this.secrets) {
            this.secrets = await getSecretStorage();
        }
        return this.secrets;
    }

    /**
     * Login with API key
     */
    async loginWithApiKey(apiKey: string): Promise<boolean> {
        if (!apiKey.startsWith(API_KEY_PREFIX)) {
            output.error("Invalid API key format. Keys should start with 'trc_'");
            return false;
        }

        // Validate key with server
        try {
            const res = await fetch(`${this.serverUrl}/v1/auth/validate`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                }
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                output.error(data.message || "Invalid API key");
                return false;
            }

            const data = await res.json();

            // Store credentials
            const secrets = await this.getSecrets();
            await secrets.set(CONFIG_KEY, JSON.stringify({
                apiKey,
                userId: data.user_id,
                orgId: data.org_id,
                email: data.email,
                serverUrl: this.serverUrl
            }));

            output.success(`Logged in as ${data.email || data.org_id}`);
            return true;
        } catch (err) {
            // If server is not reachable, still save the key (offline mode)
            output.warn("Could not validate key with server. Saving for offline use.");
            const secrets = await this.getSecrets();
            await secrets.set(CONFIG_KEY, JSON.stringify({
                apiKey,
                serverUrl: this.serverUrl
            }));
            return true;
        }
    }

    /**
     * Login with email/password (gets tokens)
     */
    async loginWithCredentials(email: string, password: string): Promise<boolean> {
        try {
            const res = await fetch(`${this.serverUrl}/v1/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password })
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                output.error(data.message || "Login failed");
                return false;
            }

            const data = await res.json();

            const secrets = await this.getSecrets();
            await secrets.set(CONFIG_KEY, JSON.stringify({
                accessToken: data.accessToken,
                refreshToken: data.refreshToken,
                userId: data.user.id,
                orgId: data.org.id,
                email: data.user.email,
                serverUrl: this.serverUrl
            }));

            output.success(`Logged in as ${data.user.email}`);
            return true;
        } catch (err) {
            output.error(`Login failed: ${err}`);
            return false;
        }
    }

    /**
     * Interactive browser login (device flow)
     */
    async loginWithBrowser(): Promise<boolean> {
        try {
            // Request device code
            const res = await fetch(`${this.serverUrl}/v1/auth/device/code`, {
                method: "POST"
            });

            if (!res.ok) {
                output.error("Failed to start browser login");
                return false;
            }

            const { device_code, user_code, verification_url, expires_in, interval } = await res.json();

            output.info(`\nOpen this URL in your browser:\n`);
            output.highlight(`  ${verification_url}\n`);
            output.info(`Enter this code: `);
            output.highlight(`  ${user_code}\n`);
            output.muted(`\nWaiting for authentication (expires in ${expires_in}s)...`);

            // Poll for completion
            const startTime = Date.now();
            const pollInterval = (interval || 5) * 1000;

            while (Date.now() - startTime < expires_in * 1000) {
                await sleep(pollInterval);

                const tokenRes = await fetch(`${this.serverUrl}/v1/auth/device/token`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ device_code })
                });

                if (tokenRes.ok) {
                    const data = await tokenRes.json();

                    const secrets = await this.getSecrets();
                    await secrets.set(CONFIG_KEY, JSON.stringify({
                        accessToken: data.accessToken,
                        refreshToken: data.refreshToken,
                        userId: data.user.id,
                        orgId: data.org.id,
                        email: data.user.email,
                        serverUrl: this.serverUrl
                    }));

                    output.success(`\nLogged in as ${data.user.email}`);
                    return true;
                }

                const errorData = await tokenRes.json().catch(() => ({}));
                if (errorData.error === "authorization_pending") {
                    continue;
                }
                if (errorData.error === "expired_token") {
                    output.error("Login expired. Please try again.");
                    return false;
                }
            }

            output.error("Login timed out. Please try again.");
            return false;
        } catch (err) {
            output.error(`Browser login failed: ${err}`);
            return false;
        }
    }

    /**
     * Logout - clear stored credentials
     */
    async logout(): Promise<void> {
        const secrets = await this.getSecrets();
        await secrets.delete(CONFIG_KEY);
        output.success("Logged out successfully");
    }

    /**
     * Get current auth config
     */
    async getAuth(): Promise<AuthConfig | null> {
        try {
            const secrets = await this.getSecrets();
            const data = await secrets.get(CONFIG_KEY);
            if (!data) return null;
            return JSON.parse(data);
        } catch (err: unknown) {
            return null;
        }
    }

    /**
     * Get authorization header for API calls
     */
    async getAuthHeader(): Promise<string | null> {
        const auth = await this.getAuth();
        if (!auth) return null;

        if (auth.apiKey) {
            return `Bearer ${auth.apiKey}`;
        }
        if (auth.accessToken) {
            // TODO: Check expiry and refresh if needed
            return `Bearer ${auth.accessToken}`;
        }
        return null;
    }

    /**
     * Check if authenticated
     */
    async isAuthenticated(): Promise<boolean> {
        const auth = await this.getAuth();
        return !!(auth?.apiKey || auth?.accessToken);
    }

    /**
     * Get current account info
     */
    async getAccountInfo(): Promise<{ email?: string; orgId?: string; plan?: string } | null> {
        const auth = await this.getAuth();
        if (!auth) return null;

        const header = await this.getAuthHeader();
        if (!header) return null;

        try {
            const res = await fetch(`${auth.serverUrl || this.serverUrl}/v1/account`, {
                headers: { "Authorization": header }
            });

            if (!res.ok) return { email: auth.email, orgId: auth.orgId };

            return await res.json();
        } catch {
            return { email: auth.email, orgId: auth.orgId };
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// CLI command handlers
export async function handleLoginCommand(args: string[]): Promise<void> {
    const auth = new AuthManager();

    // Check for --api-key flag
    const apiKeyIndex = args.indexOf("--api-key");
    if (apiKeyIndex !== -1 && args[apiKeyIndex + 1]) {
        await auth.loginWithApiKey(args[apiKeyIndex + 1]);
        return;
    }

    // Check for --email and --password flags
    const emailIndex = args.indexOf("--email");
    const passwordIndex = args.indexOf("--password");
    if (emailIndex !== -1 && passwordIndex !== -1) {
        const email = args[emailIndex + 1];
        const password = args[passwordIndex + 1];
        if (email && password) {
            await auth.loginWithCredentials(email, password);
            return;
        }
    }

    // Default: browser login
    await auth.loginWithBrowser();
}

export async function handleLogoutCommand(): Promise<void> {
    const auth = new AuthManager();
    await auth.logout();
}

export async function handleAccountCommand(): Promise<void> {
    const auth = new AuthManager();

    const isAuth = await auth.isAuthenticated();
    if (!isAuth) {
        output.error("Not logged in. Run 'trcoder login' first.");
        return;
    }

    const account = await auth.getAccountInfo();
    if (!account) {
        output.error("Could not retrieve account info");
        return;
    }

    output.info("\n  Account Information\n");
    output.info(`  Email: ${account.email || "N/A"}`);
    output.info(`  Organization: ${account.orgId || "N/A"}`);
    if (account.plan) {
        output.info(`  Plan: ${account.plan}`);
    }
    output.info("");
}
