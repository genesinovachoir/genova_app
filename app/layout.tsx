import type { Metadata, Viewport } from 'next';
import { Noto_Serif, Manrope } from 'next/font/google';
import './globals.css';
import { AppProviders } from '@/components/AppProviders';
import { AuthProvider } from '@/components/AuthProvider';

const notoSerif = Noto_Serif({
  subsets: ['latin'],
  variable: '--font-noto-serif',
});

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
});

export const metadata: Metadata = {
  title: 'Genova App',
  applicationName: 'Genova App',
  description: 'Koro Yönetim Uygulaması',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Genova App',
    statusBarStyle: 'black',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning className={`${notoSerif.variable} ${manrope.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <AppProviders>
          <AuthProvider>
            {children}
          </AuthProvider>
        </AppProviders>
        {process.env.NODE_ENV === 'development' && (
          <style dangerouslySetInnerHTML={{ __html: `
            nextjs-portal, 
            #next-prerender-indicator, 
            [data-nextjs-indicator], 
            [data-nextjs-toast-wrapper], 
            [data-next-mark-loading] { 
              display: none !important; 
              visibility: hidden !important; 
              pointer-events: none !important; 
            }
          `}} />
        )}
      </body>
    </html>
  );
}
