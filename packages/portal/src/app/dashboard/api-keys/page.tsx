'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function ApiKeysPage() {
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [newKeyName, setNewKeyName] = useState('')
    const [createdKey, setCreatedKey] = useState<string | null>(null)

    const handleCreateKey = async () => {
        // In real app, call API
        const mockKey = `trc_live_${Math.random().toString(36).substr(2, 32)}`
        setCreatedKey(mockKey)
        setShowCreateModal(false)
        setNewKeyName('')
    }

    return (
        <div className="min-h-screen">
            {/* Sidebar - Same as dashboard */}
            <aside className="fixed left-0 top-0 bottom-0 w-64 glass-dark border-r border-white/10 p-6">
                <Link href="/" className="text-2xl font-bold gradient-text block mb-10">
                    TRCODER
                </Link>
                <nav className="space-y-2">
                    <NavLink href="/dashboard" icon="📊">Dashboard</NavLink>
                    <NavLink href="/dashboard/projects" icon="📁">Projects</NavLink>
                    <NavLink href="/dashboard/runs" icon="🚀">Runs</NavLink>
                    <NavLink href="/dashboard/api-keys" icon="🔑" active>API Keys</NavLink>
                    <NavLink href="/dashboard/billing" icon="💳">Billing</NavLink>
                    <NavLink href="/dashboard/settings" icon="⚙️">Settings</NavLink>
                </nav>
            </aside>

            {/* Main Content */}
            <main className="ml-64 p-8">
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold">API Keys</h1>
                        <p className="text-white/60">Manage your API keys for CLI and integrations</p>
                    </div>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="btn-primary"
                    >
                        + Create New Key
                    </button>
                </div>

                {/* Show newly created key */}
                {createdKey && (
                    <div className="card mb-8 border-green-500/50 bg-green-500/10">
                        <div className="flex items-start justify-between">
                            <div>
                                <h3 className="text-lg font-semibold text-green-400 mb-2">
                                    ✓ API Key Created Successfully
                                </h3>
                                <p className="text-white/60 text-sm mb-4">
                                    Copy this key now. You won't be able to see it again!
                                </p>
                                <div className="flex items-center gap-4">
                                    <code className="px-4 py-2 bg-black/30 rounded font-mono text-sm">
                                        {createdKey}
                                    </code>
                                    <button
                                        onClick={() => navigator.clipboard.writeText(createdKey)}
                                        className="btn-secondary text-sm"
                                    >
                                        Copy
                                    </button>
                                </div>
                            </div>
                            <button
                                onClick={() => setCreatedKey(null)}
                                className="text-white/40 hover:text-white"
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                )}

                {/* Existing Keys */}
                <div className="card">
                    <h2 className="text-xl font-semibold mb-6">Your API Keys</h2>
                    <div className="space-y-4">
                        {apiKeys.map((key, i) => (
                            <div key={i} className="flex items-center justify-between p-4 bg-white/5 rounded-lg">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-lg bg-primary-500/20 flex items-center justify-center">
                                        🔑
                                    </div>
                                    <div>
                                        <div className="font-medium">{key.name}</div>
                                        <div className="text-sm text-white/40 font-mono">{key.prefix}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-6">
                                    <div className="text-right">
                                        <div className="text-sm text-white/60">Last used</div>
                                        <div className="text-sm">{key.lastUsed}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm text-white/60">Created</div>
                                        <div className="text-sm">{key.created}</div>
                                    </div>
                                    <button className="text-red-400 hover:text-red-300 text-sm">
                                        Revoke
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Usage Guide */}
                <div className="card mt-8">
                    <h2 className="text-xl font-semibold mb-4">Using Your API Key</h2>
                    <div className="grid md:grid-cols-2 gap-6">
                        <div>
                            <h3 className="font-medium mb-3">CLI Authentication</h3>
                            <div className="bg-black/50 rounded-lg p-4 font-mono text-sm">
                                <div className="text-white/40 mb-1"># Login with API key</div>
                                <div className="text-primary-300">trcoder login --api-key YOUR_KEY</div>
                            </div>
                        </div>
                        <div>
                            <h3 className="font-medium mb-3">API Authentication</h3>
                            <div className="bg-black/50 rounded-lg p-4 font-mono text-sm">
                                <div className="text-white/40 mb-1"># Add to request headers</div>
                                <div className="text-primary-300">Authorization: Bearer YOUR_KEY</div>
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="card w-full max-w-md mx-4">
                        <h2 className="text-xl font-semibold mb-6">Create New API Key</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">Key Name</label>
                                <input
                                    type="text"
                                    value={newKeyName}
                                    onChange={(e) => setNewKeyName(e.target.value)}
                                    className="input-field"
                                    placeholder="e.g., Production CLI"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-2">Scopes</label>
                                <div className="space-y-2">
                                    {scopes.map((scope, i) => (
                                        <label key={i} className="flex items-center gap-3 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                defaultChecked={scope.default}
                                                className="rounded bg-white/10 border-white/20"
                                            />
                                            <span>{scope.name}</span>
                                            <span className="text-white/40 text-sm">- {scope.description}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end gap-4 mt-8">
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="btn-secondary"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateKey}
                                className="btn-primary"
                                disabled={!newKeyName}
                            >
                                Create Key
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

function NavLink({ href, icon, children, active = false }: {
    href: string;
    icon: string;
    children: React.ReactNode;
    active?: boolean;
}) {
    return (
        <Link
            href={href}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${active
                    ? 'bg-primary-500/20 text-primary-400'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
        >
            <span>{icon}</span>
            {children}
        </Link>
    )
}

const apiKeys = [
    { name: 'Production CLI', prefix: 'trc_live_abc1****', lastUsed: '2 hours ago', created: 'Jan 15, 2026' },
    { name: 'Development', prefix: 'trc_test_def2****', lastUsed: '5 days ago', created: 'Dec 20, 2025' },
]

const scopes = [
    { name: 'runs:read', description: 'Read run status', default: true },
    { name: 'runs:write', description: 'Start and manage runs', default: true },
    { name: 'projects:read', description: 'Read projects', default: true },
    { name: 'projects:write', description: 'Manage projects', default: false },
    { name: 'billing:read', description: 'View billing', default: false },
]
