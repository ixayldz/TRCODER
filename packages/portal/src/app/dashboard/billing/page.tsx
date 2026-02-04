import Link from 'next/link'

export default function BillingPage() {
    const billing = {
        plan: 'Pro',
        price: '$29/month',
        nextBilling: 'Feb 15, 2026',
        credits: {
            used: 153,
            included: 1000,
            purchased: 0
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
                    <NavLink href="/dashboard" icon="📊">Dashboard</NavLink>
                    <NavLink href="/dashboard/projects" icon="📁">Projects</NavLink>
                    <NavLink href="/dashboard/runs" icon="🚀">Runs</NavLink>
                    <NavLink href="/dashboard/api-keys" icon="🔑">API Keys</NavLink>
                    <NavLink href="/dashboard/billing" icon="💳" active>Billing</NavLink>
                    <NavLink href="/dashboard/settings" icon="⚙️">Settings</NavLink>
                </nav>
            </aside>

            {/* Main Content */}
            <main className="ml-64 p-8">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold">Billing & Usage</h1>
                    <p className="text-white/60">Manage your subscription and view usage</p>
                </div>

                {/* Current Plan */}
                <div className="grid md:grid-cols-3 gap-6 mb-8">
                    <div className="card md:col-span-2">
                        <div className="flex items-start justify-between">
                            <div>
                                <div className="text-sm text-white/60 mb-1">Current Plan</div>
                                <div className="text-3xl font-bold gradient-text mb-2">{billing.plan}</div>
                                <div className="text-white/60">{billing.price}</div>
                            </div>
                            <div className="text-right">
                                <div className="text-sm text-white/60 mb-1">Next billing date</div>
                                <div className="font-medium">{billing.nextBilling}</div>
                            </div>
                        </div>
                        <div className="flex gap-4 mt-6">
                            <button className="btn-primary">Upgrade Plan</button>
                            <button className="btn-secondary">Manage Subscription</button>
                        </div>
                    </div>

                    <div className="card">
                        <div className="text-sm text-white/60 mb-1">Credit Balance</div>
                        <div className="text-4xl font-bold mb-2">
                            {billing.credits.included - billing.credits.used}
                        </div>
                        <div className="text-sm text-white/40 mb-4">
                            {billing.credits.used} used of {billing.credits.included}
                        </div>
                        <div className="h-3 bg-white/10 rounded-full overflow-hidden mb-4">
                            <div
                                className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full"
                                style={{ width: `${(billing.credits.used / billing.credits.included) * 100}%` }}
                            />
                        </div>
                        <button className="btn-secondary w-full text-sm">Buy More Credits</button>
                    </div>
                </div>

                {/* Usage Details */}
                <div className="grid md:grid-cols-2 gap-6 mb-8">
                    <div className="card">
                        <h2 className="text-xl font-semibold mb-6">This Month's Usage</h2>
                        <div className="space-y-4">
                            {usageBreakdown.map((item, i) => (
                                <div key={i} className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                                        <span className="text-white/80">{item.model}</span>
                                    </div>
                                    <div className="text-right">
                                        <div className="font-medium">{item.credits} credits</div>
                                        <div className="text-sm text-white/40">{item.runs} runs</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="card">
                        <h2 className="text-xl font-semibold mb-6">Plans Comparison</h2>
                        <div className="space-y-4">
                            {plans.map((plan, i) => (
                                <div
                                    key={i}
                                    className={`p-4 rounded-lg border transition-all ${plan.current
                                            ? 'border-primary-500 bg-primary-500/10'
                                            : 'border-white/10 hover:border-white/20'
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="font-semibold">{plan.name}</div>
                                        <div className="text-white/60">${plan.price}/mo</div>
                                    </div>
                                    <div className="text-sm text-white/40">
                                        {plan.credits.toLocaleString()} credits/month
                                    </div>
                                    {plan.current && (
                                        <span className="mt-2 inline-block px-2 py-1 bg-primary-500 text-white text-xs rounded-full">
                                            Current
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Invoices */}
                <div className="card">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-semibold">Invoice History</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="text-left text-white/40 text-sm border-b border-white/10">
                                    <th className="pb-4">Date</th>
                                    <th className="pb-4">Description</th>
                                    <th className="pb-4">Amount</th>
                                    <th className="pb-4">Status</th>
                                    <th className="pb-4"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {invoices.map((invoice, i) => (
                                    <tr key={i} className="border-b border-white/5">
                                        <td className="py-4">{invoice.date}</td>
                                        <td className="py-4">{invoice.description}</td>
                                        <td className="py-4">${invoice.amount}</td>
                                        <td className="py-4">
                                            <span className={`px-2 py-1 rounded-full text-xs ${invoice.status === 'Paid'
                                                    ? 'bg-green-500/20 text-green-400'
                                                    : 'bg-yellow-500/20 text-yellow-400'
                                                }`}>
                                                {invoice.status}
                                            </span>
                                        </td>
                                        <td className="py-4 text-right">
                                            <button className="text-primary-400 hover:text-primary-300 text-sm">
                                                Download
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
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

const usageBreakdown = [
    { model: 'GPT-4', credits: 89, runs: 12, color: '#10b981' },
    { model: 'Claude 3', credits: 45, runs: 8, color: '#0ea5e9' },
    { model: 'GPT-3.5', credits: 19, runs: 24, color: '#8b5cf6' },
]

const plans = [
    { name: 'Free', price: 0, credits: 100, current: false },
    { name: 'Pro', price: 29, credits: 1000, current: true },
    { name: 'Team', price: 99, credits: 5000, current: false },
]

const invoices = [
    { date: 'Jan 15, 2026', description: 'Pro Plan - Monthly', amount: '29.00', status: 'Paid' },
    { date: 'Dec 15, 2025', description: 'Pro Plan - Monthly', amount: '29.00', status: 'Paid' },
    { date: 'Nov 15, 2025', description: 'Pro Plan - Monthly', amount: '29.00', status: 'Paid' },
]
