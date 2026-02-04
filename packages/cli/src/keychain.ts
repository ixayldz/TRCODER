/**
 * Keychain Secret Storage
 * 
 * Cross-platform secure storage for API keys and secrets.
 * Falls back to encrypted file storage if keychain is unavailable.
 */

import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

const execAsync = promisify(exec);

const SERVICE_NAME = "trcoder";

export interface SecretStorage {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    has(key: string): Promise<boolean>;
}

/**
 * macOS Keychain storage using security CLI
 */
class MacOSKeychain implements SecretStorage {
    async get(key: string): Promise<string | null> {
        try {
            const { stdout } = await execAsync(
                `security find-generic-password -s "${SERVICE_NAME}" -a "${key}" -w 2>/dev/null`
            );
            return stdout.trim();
        } catch {
            return null;
        }
    }

    async set(key: string, value: string): Promise<void> {
        // Delete existing entry first (ignore errors)
        await this.delete(key).catch(() => { });

        await execAsync(
            `security add-generic-password -s "${SERVICE_NAME}" -a "${key}" -w "${value.replace(/"/g, '\\"')}"`
        );
    }

    async delete(key: string): Promise<void> {
        try {
            await execAsync(
                `security delete-generic-password -s "${SERVICE_NAME}" -a "${key}" 2>/dev/null`
            );
        } catch {
            // Ignore if not found
        }
    }

    async has(key: string): Promise<boolean> {
        return (await this.get(key)) !== null;
    }
}

/**
 * Windows Credential Manager storage
 */
class WindowsCredentialManager implements SecretStorage {
    async get(key: string): Promise<string | null> {
        try {
            const { stdout } = await execAsync(
                `powershell -Command "[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String((Get-StoredCredential -Target '${SERVICE_NAME}:${key}' -AsCredentialObject).Password))"`,
                { shell: "powershell.exe" }
            );
            return stdout.trim() || null;
        } catch {
            // Fallback to cmdkey
            try {
                const { stdout } = await execAsync(`cmdkey /list:${SERVICE_NAME}:${key}`);
                if (stdout.includes(key)) {
                    // Note: cmdkey doesn't return the password value directly
                    // This is a limitation of the Windows API
                    return null;
                }
                return null;
            } catch {
                return null;
            }
        }
    }

    async set(key: string, value: string): Promise<void> {
        const base64Value = Buffer.from(value).toString("base64");
        try {
            await execAsync(
                `powershell -Command "New-StoredCredential -Target '${SERVICE_NAME}:${key}' -UserName 'trcoder' -Password '${base64Value}' -Persist LocalMachine"`,
                { shell: "powershell.exe" }
            );
        } catch {
            // Fallback to cmdkey
            await execAsync(
                `cmdkey /generic:${SERVICE_NAME}:${key} /user:trcoder /pass:${base64Value}`
            );
        }
    }

    async delete(key: string): Promise<void> {
        try {
            await execAsync(
                `powershell -Command "Remove-StoredCredential -Target '${SERVICE_NAME}:${key}'"`,
                { shell: "powershell.exe" }
            );
        } catch {
            try {
                await execAsync(`cmdkey /delete:${SERVICE_NAME}:${key}`);
            } catch {
                // Ignore
            }
        }
    }

    async has(key: string): Promise<boolean> {
        return (await this.get(key)) !== null;
    }
}

/**
 * Linux Secret Service storage via secret-tool
 */
class LinuxSecretService implements SecretStorage {
    async get(key: string): Promise<string | null> {
        try {
            const { stdout } = await execAsync(
                `secret-tool lookup service "${SERVICE_NAME}" key "${key}" 2>/dev/null`
            );
            return stdout.trim() || null;
        } catch {
            return null;
        }
    }

    async set(key: string, value: string): Promise<void> {
        await execAsync(
            `echo -n "${value.replace(/"/g, '\\"')}" | secret-tool store --label="${SERVICE_NAME}:${key}" service "${SERVICE_NAME}" key "${key}"`
        );
    }

    async delete(key: string): Promise<void> {
        try {
            await execAsync(
                `secret-tool clear service "${SERVICE_NAME}" key "${key}"`
            );
        } catch {
            // Ignore
        }
    }

    async has(key: string): Promise<boolean> {
        return (await this.get(key)) !== null;
    }
}

/**
 * Encrypted file storage as fallback
 */
class EncryptedFileStorage implements SecretStorage {
    private secretsDir: string;
    private keyPath: string;
    private encryptionKey?: Buffer;

    constructor() {
        this.secretsDir = path.join(os.homedir(), ".trcoder", "secrets");
        this.keyPath = path.join(this.secretsDir, ".key");
        this.ensureDir();
    }

    private ensureDir(): void {
        if (!fs.existsSync(this.secretsDir)) {
            fs.mkdirSync(this.secretsDir, { recursive: true });
            if (process.platform !== "win32") {
                fs.chmodSync(this.secretsDir, 0o700);
            }
        }
    }

    private getEncryptionKey(): Buffer {
        if (this.encryptionKey) return this.encryptionKey;

        if (fs.existsSync(this.keyPath)) {
            this.encryptionKey = fs.readFileSync(this.keyPath);
        } else {
            this.encryptionKey = crypto.randomBytes(32);
            fs.writeFileSync(this.keyPath, this.encryptionKey);
            if (process.platform !== "win32") {
                fs.chmodSync(this.keyPath, 0o600);
            }
        }

        return this.encryptionKey;
    }

    private encrypt(text: string): string {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(
            "aes-256-gcm",
            this.getEncryptionKey(),
            iv
        );
        const encrypted = Buffer.concat([
            cipher.update(text, "utf8"),
            cipher.final()
        ]);
        const authTag = cipher.getAuthTag();
        return Buffer.concat([iv, authTag, encrypted]).toString("base64");
    }

    private decrypt(data: string): string {
        const buffer = Buffer.from(data, "base64");
        const iv = buffer.subarray(0, 16);
        const authTag = buffer.subarray(16, 32);
        const encrypted = buffer.subarray(32);

        const decipher = crypto.createDecipheriv(
            "aes-256-gcm",
            this.getEncryptionKey(),
            iv
        );
        decipher.setAuthTag(authTag);
        return decipher.update(encrypted) + decipher.final("utf8");
    }

    private getFilePath(key: string): string {
        const hash = crypto.createHash("sha256").update(key).digest("hex");
        return path.join(this.secretsDir, `${hash}.enc`);
    }

    async get(key: string): Promise<string | null> {
        const filePath = this.getFilePath(key);
        if (!fs.existsSync(filePath)) return null;
        try {
            const encrypted = fs.readFileSync(filePath, "utf8");
            return this.decrypt(encrypted);
        } catch {
            return null;
        }
    }

    async set(key: string, value: string): Promise<void> {
        const filePath = this.getFilePath(key);
        const encrypted = this.encrypt(value);
        fs.writeFileSync(filePath, encrypted);
        if (process.platform !== "win32") {
            fs.chmodSync(filePath, 0o600);
        }
    }

    async delete(key: string): Promise<void> {
        const filePath = this.getFilePath(key);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }

    async has(key: string): Promise<boolean> {
        return fs.existsSync(this.getFilePath(key));
    }
}

/**
 * Detect the best available storage method
 */
async function detectStorageMethod(): Promise<SecretStorage> {
    const platform = process.platform;

    if (platform === "darwin") {
        try {
            await execAsync("which security");
            const keychain = new MacOSKeychain();
            // Test if it works
            await keychain.set("__test__", "test");
            await keychain.delete("__test__");
            return keychain;
        } catch {
            console.warn("macOS Keychain unavailable, falling back to encrypted file storage");
        }
    }

    if (platform === "win32") {
        try {
            const cred = new WindowsCredentialManager();
            // Windows Credential Manager is always available
            return cred;
        } catch {
            console.warn("Windows Credential Manager unavailable, falling back to encrypted file storage");
        }
    }

    if (platform === "linux") {
        try {
            await execAsync("which secret-tool");
            const secretService = new LinuxSecretService();
            // Test if it works
            await secretService.set("__test__", "test");
            await secretService.delete("__test__");
            return secretService;
        } catch {
            console.warn("Linux Secret Service unavailable, falling back to encrypted file storage");
        }
    }

    return new EncryptedFileStorage();
}

// Cached storage instance
let storageInstance: SecretStorage | null = null;

export async function getSecretStorage(): Promise<SecretStorage> {
    if (!storageInstance) {
        storageInstance = await detectStorageMethod();
    }
    return storageInstance;
}

// Convenience functions
export async function getSecret(key: string): Promise<string | null> {
    const storage = await getSecretStorage();
    return storage.get(key);
}

export async function setSecret(key: string, value: string): Promise<void> {
    const storage = await getSecretStorage();
    return storage.set(key, value);
}

export async function deleteSecret(key: string): Promise<void> {
    const storage = await getSecretStorage();
    return storage.delete(key);
}

export async function hasSecret(key: string): Promise<boolean> {
    const storage = await getSecretStorage();
    return storage.has(key);
}

// Standard key names
export const SECRET_KEYS = {
    API_KEY: "api_key",
    OPENAI_API_KEY: "openai_api_key",
    ANTHROPIC_API_KEY: "anthropic_api_key",
    GITHUB_TOKEN: "github_token",
    GITLAB_TOKEN: "gitlab_token"
} as const;
