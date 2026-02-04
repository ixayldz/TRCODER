import Link from 'next/link'

export default function DashboardPage() {
    // In real app, this would come from auth context/session
    const user = {
        name: 'John Doe',
        email: 'john@example.com',
        org: {
            name: "John's Workspace",
            plan: 'Pro',
            credits_balance: 847,
            credits_included: 1000
        }
    }

    return (
        <div className="min-h-screen">
            {/* Sidebar */}
            <aside className="fixed left-0 top-0 bottom-0 w-64 glass-dark border-r border-white/10 p-6">
                <Link href="/" className="text-2xl font-bold gradient-text block mb-10">
                    TRCODER
                </Link>

                <nav className="space-y-2">
                    <NavLink href="/dashboard" icon="📊" active>Dashboard</NavLink>
                    <NavLink href="/dashboard/projects" icon="📁">Projects</NavLink>
                    <NavLink href="/dashboard/runs" icon="🚀">Runs</NavLink>
                    <NavLink href="/dashboard/api-keys" icon="🔑">API Keys</NavLink>
                    <NavLink href="/dashboard/billing" icon="💳">Billing</NavLink>
                    <NavLink href="/dashboard/settings" icon="⚙️">Settings</NavLink>
                </nav>

                <div className="absolute bottom-6 left-6 right-6">
                    <div className="card p-4">
                        <div className="text-sm text-white/60 mb-1">Credits</div>
                        <div className="text-2xl font-bold">{user.org.credits_balance}</div>
                        <div className="text-sm text-white/40">of {user.org.credits_included} included</div>
                        <div className="mt-3 h-2 bg-white/10 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full"
                                style={{ width: `${(user.org.credits_balance / user.org.credits_included) * 100}%` }}
                            />
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="ml-64 p-8">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-bold">Dashboard</h1>
                        <p className="text-white/60">Welcome back, {user.name}</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <button className="btn-secondary">
                            <span className="mr-2">📖</span>
                            Docs
                        </button>
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center font-bold">
                            {user.name.charAt(0)}
                        </div>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-4 gap-6 mb-8">
                    <StatCard title="Total Runs" value="127" change="+12%" positive />
                    <StatCard title="Tasks Completed" value="1,284" change="+8%" positive />
                    <StatCard title="Credits Used" value="153" change="-5%" positive />
                    <StatCard title="Active Projects" value="4" change="+1" positive />
                </div>

                {/* Recent Activity */}
                <div className="grid grid-cols-2 gap-6">
                    <div className="card">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-semibold">Recent Runs</h2>
                            <Link href="/dashboard/runs" className="text-primary-400 text-sm hover:text-primary-300">
                                View all →
                            </Link>
                        </div>
                        <div className="space-y-4">
                            {recentRuns.map((run, i) => (
                                <div key={i} className="flex items-center justify-between p-4 bg-white/5 rounded-lg">
                                    <div>
                                        <div className="font-medium">{run.title}</div>
                                        <div className="text-sm text-white/40">{run.project}</div>
                                    </div>
                                    <div className="text-right">
                                        <StatusBadge status={run.status} />
                                        <div className="text-sm text-white/40 mt-1">{run.time}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="card">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-semibold">Quick Actions</h2>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <QuickAction
                                icon="🚀"
                                title="New Run"
                                description="Start a new code generation"
                                href="/dashboard/runs/new"
                            />
                            <QuickAction
                                icon="📁"
                                title="New Project"
                                description="Connect a new repository"
                                href="/dashboard/projects/new"
                            />
                            <QuickAction
                                icon="🔑"
                                title="API Key"
                                description="Generate a new API key"
                                href="/dashboard/api-keys"
                            />
                            <QuickAction
                                icon="📊"
                                title="Usage"
                                description="View detailed analytics"
                                href="/dashboard/billing"
                            />
                        </div>
                    </div>
                </div>

                {/* CLI Quick Start */}
                <div className="mt-8 card">
                    <h2 className="text-xl font-semibold mb-4">Quick Start with CLI</h2>
                    <div className="bg-black/50 rounded-lg p-4 font-mono text-sm">
                        <div className="text-white/40 mb-2"># Install TRCODER CLI</div>
                        <div className="text-primary-300 mb-4">npm install -g @trcoder/cli</div>
                        <div className="text-white/40 mb-2"># Login with your API key</div>
                        <div className="text-primary-300 mb-4">trcoder login --api-key YOUR_API_KEY</div>
                        <div className="text-white/40 mb-2"># Run your first generation</div>
                        <div className="text-primary-300">trcoder run "Create a REST API for user management"</div>
                    </div>
                </div>
            </main>
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

function StatCard({ title, value, change, positive }: {
    title: string;
    value: string;
    change: string;
    positive: boolean;
}) {
    return (
        <div className="card">
            <div className="text-sm text-white/60 mb-2">{title}</div>
            <div className="text-3xl font-bold mb-1">{value}</div>
            <div className={positive ? 'text-green-400 text-sm' : 'text-red-400 text-sm'}>
                {change} from last month
            </div>
        </div>
    )
}

function StatusBadge({ status }: { status: string }) {
    const colors: Record<string, string> = {
        completed: 'bg-green-500/20 text-green-400',
        running: 'bg-primary-500/20 text-primary-400',
        failed: 'bg-red-500/20 text-red-400',
        pending: 'bg-yellow-500/20 text-yellow-400'
    }
    return (
        <span className={`px-2 py-1 rounded-full text-xs ${colors[status] || colors.pending}`}>
            {status}
        </span>
    )
}

function QuickAction({ icon, title, description, href }: {
    icon: string;
    title: string;
    description: string;
    href: string;
}) {
    return (
        <Link
            href={href}
            className="p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-all group"
        >
            <div className="text-2xl mb-2">{icon}</div>
            <div className="font-medium group-hover:text-primary-400 transition">{title}</div>
            <div className="text-sm text-white/40">{description}</div>
        </Link>
    )
}

const recentRuns = [
    { title: 'Create user authentication', project: 'my-app', status: 'completed', time: '2 min ago' },
    { title: 'Add payment integration', project: 'e-commerce', status: 'running', time: '5 min ago' },
    { title: 'Refactor database layer', project: 'my-app', status: 'completed', time: '1 hour ago' },
    { title: 'Create REST endpoints', project: 'api-server', status: 'completed', time: '2 hours ago' },
]
