import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
    title: 'TRCODER - AI-Powered Code Generation Platform',
    description: 'Generate production-ready code with AI. TRCODER helps developers ship faster with intelligent code generation, automated refactoring, and seamless integration.',
    keywords: ['AI', 'code generation', 'developer tools', 'automation', 'programming'],
    authors: [{ name: 'TRCODER Team' }],
    openGraph: {
        title: 'TRCODER - AI-Powered Code Generation',
        description: 'Ship faster with AI-powered code generation',
        type: 'website',
        locale: 'en_US',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'TRCODER',
        description: 'AI-Powered Code Generation Platform',
    },
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en" className="dark">
            <body className="font-sans antialiased">
                <div className="fixed inset-0 -z-10 overflow-hidden">
                    <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-500/20 rounded-full blur-3xl" />
                    <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-accent-500/20 rounded-full blur-3xl" />
                </div>
                {children}
            </body>
        </html>
    )
}
