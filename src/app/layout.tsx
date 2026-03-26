import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Video Silence Cutter',
  description: 'Remove silences from your videos automatically',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR">
      <body className="bg-gray-950 text-gray-100 min-h-screen antialiased">
        {children}
      </body>
    </html>
  )
}
