/**
 * PR Adapter Interface
 * 
 * Common interface for GitHub, GitLab, and other Git hosting providers
 */

export interface PullRequestData {
    title: string;
    body: string;
    sourceBranch: string;
    targetBranch: string;
    labels?: string[];
    assignees?: string[];
    reviewers?: string[];
    draft?: boolean;
}

export interface PullRequestResult {
    id: number;
    number: number;
    url: string;
    htmlUrl: string;
    state: "open" | "closed" | "merged";
    title: string;
    headBranch: string;
    baseBranch: string;
    createdAt: string;
    updatedAt: string;
}

export interface BranchResult {
    name: string;
    sha: string;
    protected: boolean;
}

export interface CommitResult {
    sha: string;
    message: string;
    url: string;
}

export interface FileChange {
    path: string;
    content: string;
    encoding?: "utf-8" | "base64";
}

export interface PrAdapterConfig {
    token: string;
    owner: string;
    repo: string;
    baseUrl?: string;
    timeout?: number;
}

export interface IPrAdapter {
    readonly name: string;

    /**
     * Create a new branch from the default branch
     */
    createBranch(branchName: string, fromBranch?: string): Promise<BranchResult>;

    /**
     * Check if a branch exists
     */
    branchExists(branchName: string): Promise<boolean>;

    /**
     * Delete a branch
     */
    deleteBranch(branchName: string): Promise<void>;

    /**
     * Create or update a file in a branch
     */
    createOrUpdateFile(
        branchName: string,
        path: string,
        content: string,
        message: string
    ): Promise<CommitResult>;

    /**
     * Apply multiple file changes in a single commit
     */
    commitFiles(
        branchName: string,
        files: FileChange[],
        message: string
    ): Promise<CommitResult>;

    /**
     * Apply a unified diff patch to a branch
     */
    applyPatch(
        branchName: string,
        patchText: string,
        commitMessage: string
    ): Promise<CommitResult>;

    /**
     * Create a pull request
     */
    createPullRequest(data: PullRequestData): Promise<PullRequestResult>;

    /**
     * Get pull request by number
     */
    getPullRequest(prNumber: number): Promise<PullRequestResult>;

    /**
     * Update pull request
     */
    updatePullRequest(
        prNumber: number,
        data: Partial<PullRequestData>
    ): Promise<PullRequestResult>;

    /**
     * Add reviewers to a pull request
     */
    addReviewers(prNumber: number, reviewers: string[]): Promise<void>;

    /**
     * Merge a pull request
     */
    mergePullRequest(
        prNumber: number,
        mergeMethod?: "merge" | "squash" | "rebase"
    ): Promise<void>;

    /**
     * Close a pull request without merging
     */
    closePullRequest(prNumber: number): Promise<void>;

    /**
     * Get the default branch name
     */
    getDefaultBranch(): Promise<string>;

    /**
     * Get latest commit SHA of a branch
     */
    getBranchSha(branchName: string): Promise<string>;

    /**
     * Health check
     */
    healthCheck(): Promise<{ healthy: boolean; rateLimitRemaining?: number }>;
}

export class PrAdapterError extends Error {
    constructor(
        message: string,
        public readonly adapter: string,
        public readonly statusCode?: number,
        public readonly retryable: boolean = false,
        public readonly cause?: Error
    ) {
        super(message);
        this.name = "PrAdapterError";
    }
}

export class RateLimitExceededError extends PrAdapterError {
    constructor(
        adapter: string,
        public readonly retryAfterMs?: number,
        cause?: Error
    ) {
        super(`Rate limit exceeded for ${adapter}`, adapter, 429, true, cause);
        this.name = "RateLimitExceededError";
    }
}

export class AuthenticationFailedError extends PrAdapterError {
    constructor(adapter: string, cause?: Error) {
        super(`Authentication failed for ${adapter}`, adapter, 401, false, cause);
        this.name = "AuthenticationFailedError";
    }
}

export class ResourceNotFoundError extends PrAdapterError {
    constructor(adapter: string, resource: string, cause?: Error) {
        super(`${resource} not found in ${adapter}`, adapter, 404, false, cause);
        this.name = "ResourceNotFoundError";
    }
}

export class ConflictError extends PrAdapterError {
    constructor(adapter: string, message: string, cause?: Error) {
        super(message, adapter, 409, false, cause);
        this.name = "ConflictError";
    }
}
