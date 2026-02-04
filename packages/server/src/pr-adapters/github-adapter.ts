/**
 * GitHub PR Adapter
 * 
 * Real implementation for GitHub API integration
 */

import {
    IPrAdapter,
    PrAdapterConfig,
    PullRequestData,
    PullRequestResult,
    BranchResult,
    CommitResult,
    FileChange,
    PrAdapterError,
    RateLimitExceededError,
    AuthenticationFailedError,
    ResourceNotFoundError,
    ConflictError
} from "./pr-adapter.interface";

const DEFAULT_BASE_URL = "https://api.github.com";
const DEFAULT_TIMEOUT = 30000;

interface GitHubApiConfig extends PrAdapterConfig {
    userAgent?: string;
}

export class GitHubAdapter implements IPrAdapter {
    readonly name = "github";
    private config: GitHubApiConfig;
    private defaultBranch?: string;

    constructor(config: GitHubApiConfig) {
        this.config = {
            baseUrl: DEFAULT_BASE_URL,
            timeout: DEFAULT_TIMEOUT,
            userAgent: "TRCODER/1.0",
            ...config
        };
    }

    static fromEnv(owner: string, repo: string): GitHubAdapter {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
            throw new Error("GITHUB_TOKEN environment variable is required");
        }
        return new GitHubAdapter({
            token,
            owner,
            repo,
            baseUrl: process.env.GITHUB_API_URL
        });
    }

    private async request<T>(
        method: string,
        endpoint: string,
        body?: Record<string, unknown>
    ): Promise<T> {
        const url = `${this.config.baseUrl}${endpoint}`;
        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.config.token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": this.config.userAgent ?? "TRCODER",
            "X-GitHub-Api-Version": "2022-11-28"
        };

        if (body) {
            headers["Content-Type"] = "application/json";
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            const response = await fetch(url, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });

            if (!response.ok) {
                await this.handleError(response);
            }

            if (response.status === 204) {
                return {} as T;
            }

            return await response.json() as T;
        } finally {
            clearTimeout(timeout);
        }
    }

    private async handleError(response: Response): Promise<never> {
        const body = await response.text();

        if (response.status === 429) {
            const retryAfter = response.headers.get("retry-after");
            const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
            throw new RateLimitExceededError("github", retryMs);
        }

        if (response.status === 401 || response.status === 403) {
            throw new AuthenticationFailedError("github");
        }

        if (response.status === 404) {
            throw new ResourceNotFoundError("github", "Resource");
        }

        if (response.status === 409 || response.status === 422) {
            throw new ConflictError("github", `Conflict: ${body}`);
        }

        throw new PrAdapterError(
            `GitHub API error: ${body}`,
            "github",
            response.status,
            response.status >= 500
        );
    }

    async getDefaultBranch(): Promise<string> {
        if (this.defaultBranch) return this.defaultBranch;

        const repo = await this.request<{ default_branch: string }>(
            "GET",
            `/repos/${this.config.owner}/${this.config.repo}`
        );
        this.defaultBranch = repo.default_branch;
        return this.defaultBranch;
    }

    async getBranchSha(branchName: string): Promise<string> {
        const ref = await this.request<{ object: { sha: string } }>(
            "GET",
            `/repos/${this.config.owner}/${this.config.repo}/git/ref/heads/${branchName}`
        );
        return ref.object.sha;
    }

    async branchExists(branchName: string): Promise<boolean> {
        try {
            await this.getBranchSha(branchName);
            return true;
        } catch (error) {
            if (error instanceof ResourceNotFoundError) {
                return false;
            }
            throw error;
        }
    }

    async createBranch(branchName: string, fromBranch?: string): Promise<BranchResult> {
        const sourceBranch = fromBranch ?? await this.getDefaultBranch();
        const sha = await this.getBranchSha(sourceBranch);

        const ref = await this.request<{
            ref: string;
            object: { sha: string };
        }>("POST", `/repos/${this.config.owner}/${this.config.repo}/git/refs`, {
            ref: `refs/heads/${branchName}`,
            sha
        });

        return {
            name: branchName,
            sha: ref.object.sha,
            protected: false
        };
    }

    async deleteBranch(branchName: string): Promise<void> {
        await this.request<void>(
            "DELETE",
            `/repos/${this.config.owner}/${this.config.repo}/git/refs/heads/${branchName}`
        );
    }

    async createOrUpdateFile(
        branchName: string,
        path: string,
        content: string,
        message: string
    ): Promise<CommitResult> {
        // Try to get existing file SHA
        let fileSha: string | undefined;
        try {
            const file = await this.request<{ sha: string }>(
                "GET",
                `/repos/${this.config.owner}/${this.config.repo}/contents/${path}?ref=${branchName}`
            );
            fileSha = file.sha;
        } catch (error) {
            if (!(error instanceof ResourceNotFoundError)) {
                throw error;
            }
        }

        const response = await this.request<{
            commit: { sha: string; html_url: string; message: string };
        }>("PUT", `/repos/${this.config.owner}/${this.config.repo}/contents/${path}`, {
            message,
            content: Buffer.from(content).toString("base64"),
            branch: branchName,
            ...(fileSha && { sha: fileSha })
        });

        return {
            sha: response.commit.sha,
            message: response.commit.message,
            url: response.commit.html_url
        };
    }

    async commitFiles(
        branchName: string,
        files: FileChange[],
        message: string
    ): Promise<CommitResult> {
        // Get the current commit SHA
        const branchSha = await this.getBranchSha(branchName);

        // Get the tree SHA
        const commit = await this.request<{ tree: { sha: string } }>(
            "GET",
            `/repos/${this.config.owner}/${this.config.repo}/git/commits/${branchSha}`
        );

        // Create blobs for each file
        const treeItems = await Promise.all(
            files.map(async (file) => {
                const blob = await this.request<{ sha: string }>(
                    "POST",
                    `/repos/${this.config.owner}/${this.config.repo}/git/blobs`,
                    {
                        content: file.encoding === "base64" ? file.content : Buffer.from(file.content).toString("base64"),
                        encoding: "base64"
                    }
                );
                return {
                    path: file.path,
                    mode: "100644" as const,
                    type: "blob" as const,
                    sha: blob.sha
                };
            })
        );

        // Create a new tree
        const newTree = await this.request<{ sha: string }>(
            "POST",
            `/repos/${this.config.owner}/${this.config.repo}/git/trees`,
            {
                base_tree: commit.tree.sha,
                tree: treeItems
            }
        );

        // Create a new commit
        const newCommit = await this.request<{ sha: string; html_url: string }>(
            "POST",
            `/repos/${this.config.owner}/${this.config.repo}/git/commits`,
            {
                message,
                tree: newTree.sha,
                parents: [branchSha]
            }
        );

        // Update the branch reference
        await this.request<void>(
            "PATCH",
            `/repos/${this.config.owner}/${this.config.repo}/git/refs/heads/${branchName}`,
            {
                sha: newCommit.sha
            }
        );

        return {
            sha: newCommit.sha,
            message,
            url: newCommit.html_url
        };
    }

    async applyPatch(
        branchName: string,
        patchText: string,
        commitMessage: string
    ): Promise<CommitResult> {
        // Parse the patch to extract file changes
        const files = this.parsePatch(patchText);

        if (files.length === 0) {
            throw new PrAdapterError("No file changes found in patch", "github", 400, false);
        }

        return this.commitFiles(branchName, files, commitMessage);
    }

    private parsePatch(patchText: string): FileChange[] {
        const files: FileChange[] = [];
        const diffRegex = /^diff --git a\/(.+?) b\/(.+?)$/gm;
        const chunks = patchText.split(/(?=^diff --git)/m).filter(Boolean);

        for (const chunk of chunks) {
            const match = /^diff --git a\/(.+?) b\/(.+?)$/m.exec(chunk);
            if (!match) continue;

            const filePath = match[2];

            // Extract the new content (simplified - in production, use proper patch parsing)
            const newFileMatch = /^\+\+\+ b\/(.+?)$/m.exec(chunk);
            if (!newFileMatch) continue;

            // Extract added lines
            const lines = chunk.split("\n");
            const contentLines: string[] = [];
            let inHunk = false;

            for (const line of lines) {
                if (line.startsWith("@@")) {
                    inHunk = true;
                    continue;
                }
                if (inHunk) {
                    if (line.startsWith("+") && !line.startsWith("+++")) {
                        contentLines.push(line.slice(1));
                    } else if (!line.startsWith("-")) {
                        contentLines.push(line.startsWith(" ") ? line.slice(1) : line);
                    }
                }
            }

            if (contentLines.length > 0) {
                files.push({
                    path: filePath,
                    content: contentLines.join("\n")
                });
            }
        }

        return files;
    }

    async createPullRequest(data: PullRequestData): Promise<PullRequestResult> {
        const response = await this.request<{
            id: number;
            number: number;
            url: string;
            html_url: string;
            state: string;
            title: string;
            head: { ref: string };
            base: { ref: string };
            created_at: string;
            updated_at: string;
        }>("POST", `/repos/${this.config.owner}/${this.config.repo}/pulls`, {
            title: data.title,
            body: data.body,
            head: data.sourceBranch,
            base: data.targetBranch,
            draft: data.draft ?? false
        });

        // Add labels if specified
        if (data.labels && data.labels.length > 0) {
            await this.request<void>(
                "POST",
                `/repos/${this.config.owner}/${this.config.repo}/issues/${response.number}/labels`,
                { labels: data.labels }
            );
        }

        // Add reviewers if specified
        if (data.reviewers && data.reviewers.length > 0) {
            await this.addReviewers(response.number, data.reviewers);
        }

        // Add assignees if specified
        if (data.assignees && data.assignees.length > 0) {
            await this.request<void>(
                "POST",
                `/repos/${this.config.owner}/${this.config.repo}/issues/${response.number}/assignees`,
                { assignees: data.assignees }
            );
        }

        return {
            id: response.id,
            number: response.number,
            url: response.url,
            htmlUrl: response.html_url,
            state: response.state as PullRequestResult["state"],
            title: response.title,
            headBranch: response.head.ref,
            baseBranch: response.base.ref,
            createdAt: response.created_at,
            updatedAt: response.updated_at
        };
    }

    async getPullRequest(prNumber: number): Promise<PullRequestResult> {
        const response = await this.request<{
            id: number;
            number: number;
            url: string;
            html_url: string;
            state: string;
            title: string;
            head: { ref: string };
            base: { ref: string };
            created_at: string;
            updated_at: string;
        }>("GET", `/repos/${this.config.owner}/${this.config.repo}/pulls/${prNumber}`);

        return {
            id: response.id,
            number: response.number,
            url: response.url,
            htmlUrl: response.html_url,
            state: response.state as PullRequestResult["state"],
            title: response.title,
            headBranch: response.head.ref,
            baseBranch: response.base.ref,
            createdAt: response.created_at,
            updatedAt: response.updated_at
        };
    }

    async updatePullRequest(
        prNumber: number,
        data: Partial<PullRequestData>
    ): Promise<PullRequestResult> {
        const response = await this.request<{
            id: number;
            number: number;
            url: string;
            html_url: string;
            state: string;
            title: string;
            head: { ref: string };
            base: { ref: string };
            created_at: string;
            updated_at: string;
        }>("PATCH", `/repos/${this.config.owner}/${this.config.repo}/pulls/${prNumber}`, {
            ...(data.title && { title: data.title }),
            ...(data.body && { body: data.body }),
            ...(data.targetBranch && { base: data.targetBranch })
        });

        return {
            id: response.id,
            number: response.number,
            url: response.url,
            htmlUrl: response.html_url,
            state: response.state as PullRequestResult["state"],
            title: response.title,
            headBranch: response.head.ref,
            baseBranch: response.base.ref,
            createdAt: response.created_at,
            updatedAt: response.updated_at
        };
    }

    async addReviewers(prNumber: number, reviewers: string[]): Promise<void> {
        await this.request<void>(
            "POST",
            `/repos/${this.config.owner}/${this.config.repo}/pulls/${prNumber}/requested_reviewers`,
            { reviewers }
        );
    }

    async mergePullRequest(
        prNumber: number,
        mergeMethod: "merge" | "squash" | "rebase" = "squash"
    ): Promise<void> {
        await this.request<void>(
            "PUT",
            `/repos/${this.config.owner}/${this.config.repo}/pulls/${prNumber}/merge`,
            { merge_method: mergeMethod }
        );
    }

    async closePullRequest(prNumber: number): Promise<void> {
        await this.request<void>(
            "PATCH",
            `/repos/${this.config.owner}/${this.config.repo}/pulls/${prNumber}`,
            { state: "closed" }
        );
    }

    async healthCheck(): Promise<{ healthy: boolean; rateLimitRemaining?: number }> {
        try {
            const response = await fetch(`${this.config.baseUrl}/rate_limit`, {
                headers: {
                    Authorization: `Bearer ${this.config.token}`,
                    Accept: "application/vnd.github+json"
                }
            });

            if (!response.ok) {
                return { healthy: false };
            }

            const data = await response.json() as { rate: { remaining: number } };
            return {
                healthy: true,
                rateLimitRemaining: data.rate.remaining
            };
        } catch {
            return { healthy: false };
        }
    }
}
