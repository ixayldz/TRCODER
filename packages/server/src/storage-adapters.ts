/**
 * Storage Interfaces and Adapters
 * 
 * Support for local file storage and S3-compatible remote storage (including R2)
 */

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

export interface StorageAdapter {
    readonly name: string;

    /**
     * Store data at a path
     */
    put(key: string, data: Buffer | string): Promise<void>;

    /**
     * Retrieve data from a path
     */
    get(key: string): Promise<Buffer | null>;

    /**
     * Check if a path exists
     */
    exists(key: string): Promise<boolean>;

    /**
     * Delete data at a path
     */
    delete(key: string): Promise<void>;

    /**
     * List keys with a prefix
     */
    list(prefix?: string): Promise<string[]>;

    /**
     * Get a signed URL for temporary access (remote storage only)
     */
    getSignedUrl?(key: string, expiresIn?: number): Promise<string>;

    /**
     * Health check
     */
    healthCheck(): Promise<{ healthy: boolean; latencyMs?: number }>;
}

/**
 * Local file system storage adapter
 */
export class LocalStorageAdapter implements StorageAdapter {
    readonly name = "local";
    private baseDir: string;

    constructor(baseDir?: string) {
        this.baseDir = baseDir ?? path.join(os.homedir(), ".trcoder", "artifacts");
        this.ensureDir(this.baseDir);
    }

    private ensureDir(dir: string): void {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    private getFullPath(key: string): string {
        // Normalize path separators and prevent directory traversal
        const normalized = key.replace(/\\/g, "/").replace(/\.\./g, "");
        return path.join(this.baseDir, normalized);
    }

    async put(key: string, data: Buffer | string): Promise<void> {
        const fullPath = this.getFullPath(key);
        const dir = path.dirname(fullPath);
        this.ensureDir(dir);
        fs.writeFileSync(fullPath, data);
    }

    async get(key: string): Promise<Buffer | null> {
        const fullPath = this.getFullPath(key);
        if (!fs.existsSync(fullPath)) return null;
        return fs.readFileSync(fullPath);
    }

    async exists(key: string): Promise<boolean> {
        return fs.existsSync(this.getFullPath(key));
    }

    async delete(key: string): Promise<void> {
        const fullPath = this.getFullPath(key);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }
    }

    async list(prefix?: string): Promise<string[]> {
        const results: string[] = [];
        const searchDir = prefix
            ? this.getFullPath(prefix)
            : this.baseDir;

        if (!fs.existsSync(searchDir)) return results;

        const walk = (dir: string, base: string): void => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const relative = path.join(base, entry.name);
                if (entry.isDirectory()) {
                    walk(path.join(dir, entry.name), relative);
                } else {
                    results.push(relative.replace(/\\/g, "/"));
                }
            }
        };

        if (fs.statSync(searchDir).isDirectory()) {
            walk(searchDir, prefix ?? "");
        } else {
            results.push(prefix ?? "");
        }

        return results;
    }

    async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number }> {
        const start = Date.now();
        try {
            const testKey = `.health-check-${Date.now()}`;
            await this.put(testKey, "test");
            await this.delete(testKey);
            return { healthy: true, latencyMs: Date.now() - start };
        } catch {
            return { healthy: false, latencyMs: Date.now() - start };
        }
    }
}

/**
 * S3-compatible storage adapter
 */
export class S3StorageAdapter implements StorageAdapter {
    readonly name = "s3";
    private bucket: string;
    private region: string;
    private accessKeyId: string;
    private secretAccessKey: string;
    private endpoint?: string;
    private prefix: string;

    constructor(config: {
        bucket: string;
        region?: string;
        accessKeyId?: string;
        secretAccessKey?: string;
        endpoint?: string;
        prefix?: string;
    }) {
        this.bucket = config.bucket;
        this.region = config.region ?? "us-east-1";
        this.accessKeyId = config.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID ?? "";
        this.secretAccessKey = config.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY ?? "";
        this.endpoint = config.endpoint ?? process.env.AWS_S3_ENDPOINT;
        this.prefix = config.prefix ?? "trcoder/";

        if (!this.accessKeyId || !this.secretAccessKey) {
            throw new Error("S3 credentials are required for remote storage");
        }
    }

    static fromEnv(): S3StorageAdapter {
        const bucket = process.env.AWS_S3_BUCKET;
        if (!bucket) {
            throw new Error("AWS_S3_BUCKET environment variable is required");
        }
        return new S3StorageAdapter({
            bucket,
            region: process.env.AWS_S3_REGION ?? process.env.AWS_REGION,
            prefix: process.env.AWS_S3_PREFIX
        });
    }

    static fromR2Env(): S3StorageAdapter {
        const bucket = process.env.R2_BUCKET;
        if (!bucket) {
            throw new Error("R2_BUCKET environment variable is required");
        }
        const accountId = process.env.R2_ACCOUNT_ID;
        const endpoint =
            process.env.R2_ENDPOINT ??
            (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

        return new S3StorageAdapter({
            bucket,
            region: process.env.R2_REGION ?? "auto",
            accessKeyId: process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
            endpoint,
            prefix: process.env.R2_PREFIX ?? process.env.AWS_S3_PREFIX
        });
    }

    private getKey(key: string): string {
        return `${this.prefix}${key}`;
    }

    private getHost(): string {
        if (this.endpoint) {
            return this.endpoint.replace(/^https?:\/\//, "");
        }
        return `${this.bucket}.s3.${this.region}.amazonaws.com`;
    }

    private getBaseUrl(): string {
        if (this.endpoint) {
            return `${this.endpoint}/${this.bucket}`;
        }
        return `https://${this.bucket}.s3.${this.region}.amazonaws.com`;
    }

    private sign(
        method: string,
        path: string,
        headers: Record<string, string>,
        payload?: Buffer | string
    ): Record<string, string> {
        const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
        const date = datetime.slice(0, 8);

        const payloadHash = payload
            ? crypto.createHash("sha256").update(payload).digest("hex")
            : "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

        const canonicalHeaders = Object.entries(headers)
            .map(([k, v]) => `${k.toLowerCase()}:${v.trim()}`)
            .sort()
            .join("\n");
        const signedHeaders = Object.keys(headers)
            .map((k) => k.toLowerCase())
            .sort()
            .join(";");

        const canonicalRequest = [
            method,
            path,
            "",
            canonicalHeaders,
            "",
            signedHeaders,
            payloadHash
        ].join("\n");

        const scope = `${date}/${this.region}/s3/aws4_request`;
        const stringToSign = [
            "AWS4-HMAC-SHA256",
            datetime,
            scope,
            crypto.createHash("sha256").update(canonicalRequest).digest("hex")
        ].join("\n");

        const kDate = crypto.createHmac("sha256", `AWS4${this.secretAccessKey}`).update(date).digest();
        const kRegion = crypto.createHmac("sha256", kDate).update(this.region).digest();
        const kService = crypto.createHmac("sha256", kRegion).update("s3").digest();
        const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();
        const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

        return {
            ...headers,
            "x-amz-date": datetime,
            "x-amz-content-sha256": payloadHash,
            Authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
        };
    }

    async put(key: string, data: Buffer | string): Promise<void> {
        const fullKey = this.getKey(key);
        const url = `${this.getBaseUrl()}/${fullKey}`;
        const body = typeof data === "string" ? Buffer.from(data) : data;

        const headers = this.sign("PUT", `/${fullKey}`, {
            Host: this.getHost(),
            "Content-Type": "application/octet-stream",
            "Content-Length": String(body.length)
        }, body);

        const response = await fetch(url, {
            method: "PUT",
            headers,
            body: new Uint8Array(body)
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`S3 PUT failed: ${response.status} ${error}`);
        }
    }

    async get(key: string): Promise<Buffer | null> {
        const fullKey = this.getKey(key);
        const url = `${this.getBaseUrl()}/${fullKey}`;

        const headers = this.sign("GET", `/${fullKey}`, {
            Host: this.getHost()
        });

        const response = await fetch(url, {
            method: "GET",
            headers
        });

        if (response.status === 404) return null;

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`S3 GET failed: ${response.status} ${error}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    async exists(key: string): Promise<boolean> {
        const fullKey = this.getKey(key);
        const url = `${this.getBaseUrl()}/${fullKey}`;

        const headers = this.sign("HEAD", `/${fullKey}`, {
            Host: this.getHost()
        });

        const response = await fetch(url, {
            method: "HEAD",
            headers
        });

        return response.ok;
    }

    async delete(key: string): Promise<void> {
        const fullKey = this.getKey(key);
        const url = `${this.getBaseUrl()}/${fullKey}`;

        const headers = this.sign("DELETE", `/${fullKey}`, {
            Host: this.getHost()
        });

        const response = await fetch(url, {
            method: "DELETE",
            headers
        });

        if (!response.ok && response.status !== 404) {
            const error = await response.text();
            throw new Error(`S3 DELETE failed: ${response.status} ${error}`);
        }
    }

    async list(prefix?: string): Promise<string[]> {
        const fullPrefix = this.getKey(prefix ?? "");
        const url = `${this.getBaseUrl()}/?list-type=2&prefix=${encodeURIComponent(fullPrefix)}`;

        const headers = this.sign("GET", "/", {
            Host: this.getHost()
        });

        const response = await fetch(url, {
            method: "GET",
            headers
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`S3 LIST failed: ${response.status} ${error}`);
        }

        const xml = await response.text();
        const keys: string[] = [];
        const keyRegex = /<Key>([^<]+)<\/Key>/g;
        let match;
        while ((match = keyRegex.exec(xml)) !== null) {
            // Remove prefix
            const key = match[1].replace(this.prefix, "");
            keys.push(key);
        }

        return keys;
    }

    async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
        const fullKey = this.getKey(key);
        const datetime = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
        const date = datetime.slice(0, 8);
        const scope = `${date}/${this.region}/s3/aws4_request`;

        const params = new URLSearchParams({
            "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
            "X-Amz-Credential": `${this.accessKeyId}/${scope}`,
            "X-Amz-Date": datetime,
            "X-Amz-Expires": String(expiresIn),
            "X-Amz-SignedHeaders": "host"
        });

        const canonicalRequest = [
            "GET",
            `/${fullKey}`,
            params.toString(),
            `host:${this.getHost()}`,
            "",
            "host",
            "UNSIGNED-PAYLOAD"
        ].join("\n");

        const stringToSign = [
            "AWS4-HMAC-SHA256",
            datetime,
            scope,
            crypto.createHash("sha256").update(canonicalRequest).digest("hex")
        ].join("\n");

        const kDate = crypto.createHmac("sha256", `AWS4${this.secretAccessKey}`).update(date).digest();
        const kRegion = crypto.createHmac("sha256", kDate).update(this.region).digest();
        const kService = crypto.createHmac("sha256", kRegion).update("s3").digest();
        const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();
        const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

        params.append("X-Amz-Signature", signature);
        return `${this.getBaseUrl()}/${fullKey}?${params.toString()}`;
    }

    async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number }> {
        const start = Date.now();
        try {
            await this.list("");
            return { healthy: true, latencyMs: Date.now() - start };
        } catch {
            return { healthy: false, latencyMs: Date.now() - start };
        }
    }
}

/**
 * Storage factory - creates storage adapter based on environment
 */
export function createStorageAdapter(type?: "local" | "s3" | "r2"): StorageAdapter {
    const storageType = type ?? (process.env.TRCODER_STORAGE ?? "local");

    if (storageType === "r2" && process.env.R2_BUCKET) {
        return S3StorageAdapter.fromR2Env();
    }
    if (storageType === "s3" && process.env.AWS_S3_BUCKET) {
        return S3StorageAdapter.fromEnv();
    }

    return new LocalStorageAdapter();
}

// Re-export existing functions for backward compatibility
export { getDataDir, getArtifactsDir, ensureDir } from "./storage";
