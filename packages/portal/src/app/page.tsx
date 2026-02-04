import Link from 'next/link'

export default function HomePage() {
    return (
        <div className="min-h-screen">
            {/* Navigation */}
            <nav className="fixed top-0 left-0 right-0 z-50 glass-dark">
                <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                    <Link href="/" className="text-2xl font-bold gradient-text">
                        TRCODER
                    </Link>
                    <div className="hidden md:flex items-center gap-8">
                        <Link href="#features" className="text-white/70 hover:text-white transition">
                            Features
                        </Link>
                        <Link href="#pricing" className="text-white/70 hover:text-white transition">
                            Pricing
                        </Link>
                        <Link href="/docs" className="text-white/70 hover:text-white transition">
                            Docs
                        </Link>
                    </div>
                    <div className="flex items-center gap-4">
                        <Link href="/login" className="btn-secondary text-sm">
                            Login
                        </Link>
                        <Link href="/register" className="btn-primary text-sm">
                            Get Started
                        </Link>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <section className="pt-32 pb-20 px-6">
                <div className="max-w-5xl mx-auto text-center">
                    <div className="inline-block px-4 py-2 glass rounded-full text-sm text-primary-300 mb-8 animate-fade-in">
                        🚀 V1.0 Now Available
                    </div>
                    <h1 className="text-5xl md:text-7xl font-bold mb-6 animate-slide-up">
                        Ship Code <span className="gradient-text">10x Faster</span>
                        <br />with AI
                    </h1>
                    <p className="text-xl text-white/60 mb-10 max-w-2xl mx-auto animate-slide-up">
                        TRCODER generates production-ready code from your specifications.
                        Less boilerplate, more creating. Start building faster today.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center animate-slide-up">
                        <Link href="/register" className="btn-primary text-lg px-8 py-4">
                            Start Free Trial
                        </Link>
                        <Link href="/docs" className="btn-secondary text-lg px-8 py-4">
                            View Documentation
                        </Link>
                    </div>

                    {/* Code Preview */}
                    <div className="mt-16 glass rounded-2xl p-6 text-left max-w-3xl mx-auto animate-glow">
                        <div className="flex items-center gap-2 mb-4">
                            <div className="w-3 h-3 rounded-full bg-red-500" />
                            <div className="w-3 h-3 rounded-full bg-yellow-500" />
                            <div className="w-3 h-3 rounded-full bg-green-500" />
                            <span className="ml-4 text-white/40 text-sm font-mono">terminal</span>
                        </div>
                        <pre className="font-mono text-sm text-white/80 overflow-x-auto">
                            {`$ trcoder run "Create a REST API for user management"

✓ Analyzing requirements...
✓ Generating code structure...
✓ Creating models, routes, controllers...
✓ Adding tests and documentation...

Generated 12 files in 8.3 seconds
→ src/routes/users.ts
→ src/models/user.ts
→ src/controllers/userController.ts
→ ...and 9 more files

Ready for review! Run 'trcoder apply' to commit changes.`}
                        </pre>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section id="features" className="py-20 px-6">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-4xl font-bold text-center mb-4">
                        Why Developers Love <span className="gradient-text">TRCODER</span>
                    </h2>
                    <p className="text-white/60 text-center mb-16 max-w-2xl mx-auto">
                        Built by developers, for developers. Every feature is designed to help you ship faster.
                    </p>

                    <div className="grid md:grid-cols-3 gap-8">
                        {features.map((feature, i) => (
                            <div key={i} className="card-hover">
                                <div className="text-4xl mb-4">{feature.icon}</div>
                                <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                                <p className="text-white/60">{feature.description}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Pricing Section */}
            <section id="pricing" className="py-20 px-6">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-4xl font-bold text-center mb-4">
                        Simple, Transparent <span className="gradient-text">Pricing</span>
                    </h2>
                    <p className="text-white/60 text-center mb-16 max-w-2xl mx-auto">
                        Start free, upgrade when you need more. No hidden fees.
                    </p>

                    <div className="grid md:grid-cols-3 gap-8">
                        {plans.map((plan, i) => (
                            <div key={i} className={`card ${plan.highlighted ? 'border-primary-500 animate-glow' : ''}`}>
                                {plan.highlighted && (
                                    <div className="px-3 py-1 bg-primary-500 text-white text-sm rounded-full inline-block mb-4">
                                        Most Popular
                                    </div>
                                )}
                                <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                                <div className="mb-4">
                                    <span className="text-4xl font-bold">${plan.price}</span>
                                    {plan.price > 0 && <span className="text-white/60">/month</span>}
                                </div>
                                <p className="text-white/60 mb-6">{plan.description}</p>
                                <ul className="space-y-3 mb-8">
                                    {plan.features.map((feature, j) => (
                                        <li key={j} className="flex items-center gap-2 text-white/80">
                                            <span className="text-primary-400">✓</span>
                                            {feature}
                                        </li>
                                    ))}
                                </ul>
                                <Link
                                    href={plan.price === 0 ? '/register' : '/register?plan=' + plan.id}
                                    className={plan.highlighted ? 'btn-primary w-full text-center block' : 'btn-secondary w-full text-center block'}
                                >
                                    {plan.price === 0 ? 'Get Started Free' : 'Start Trial'}
                                </Link>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="py-20 px-6">
                <div className="max-w-4xl mx-auto text-center glass rounded-3xl p-12">
                    <h2 className="text-4xl font-bold mb-4">
                        Ready to <span className="gradient-text">Ship Faster</span>?
                    </h2>
                    <p className="text-white/60 mb-8 text-lg">
                        Join thousands of developers already using TRCODER.
                    </p>
                    <Link href="/register" className="btn-primary text-lg px-10 py-4">
                        Start Your Free Trial
                    </Link>
                </div>
            </section>

            {/* Footer */}
            <footer className="py-12 px-6 border-t border-white/10">
                <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="text-2xl font-bold gradient-text">TRCODER</div>
                    <div className="flex gap-8 text-white/60">
                        <Link href="/docs" className="hover:text-white transition">Docs</Link>
                        <Link href="/pricing" className="hover:text-white transition">Pricing</Link>
                        <Link href="/blog" className="hover:text-white transition">Blog</Link>
                        <Link href="/support" className="hover:text-white transition">Support</Link>
                    </div>
                    <div className="text-white/40 text-sm">
                        © 2026 TRCODER. All rights reserved.
                    </div>
                </div>
            </footer>
        </div>
    )
}

const features = [
    {
        icon: '⚡',
        title: 'Lightning Fast',
        description: 'Generate entire features in seconds. Our AI understands your codebase and generates contextually relevant code.',
    },
    {
        icon: '🔒',
        title: 'Secure by Default',
        description: 'Your code never leaves your machine. All processing happens locally with optional cloud sync.',
    },
    {
        icon: '🎯',
        title: 'Production Ready',
        description: 'Generated code follows best practices, includes tests, and is ready for production deployment.',
    },
    {
        icon: '🔌',
        title: 'IDE Integration',
        description: 'Seamless integration with VS Code, JetBrains, and Vim. Use TRCODER where you already work.',
    },
    {
        icon: '🤖',
        title: 'Multiple AI Models',
        description: 'Choose from GPT-4, Claude, or bring your own model. Optimize for speed or quality.',
    },
    {
        icon: '📊',
        title: 'Usage Analytics',
        description: 'Track your team\'s productivity gains with detailed analytics and reporting.',
    },
]

const plans = [
    {
        id: 'free',
        name: 'Free',
        price: 0,
        description: 'Perfect for trying out TRCODER',
        features: ['100 credits/month', '1 project', 'Community support', 'Basic models'],
        highlighted: false,
    },
    {
        id: 'pro',
        name: 'Pro',
        price: 29,
        description: 'For individual developers',
        features: ['1,000 credits/month', '10 projects', 'Email support', 'All models', 'Priority queue'],
        highlighted: true,
    },
    {
        id: 'team',
        name: 'Team',
        price: 99,
        description: 'For growing teams',
        features: ['5,000 credits/month', 'Unlimited projects', 'Priority support', 'Team collaboration', 'Usage analytics'],
        highlighted: false,
    },
]
