import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Mapua School OS',
    template: '%s · Mapua School OS',
  },
  description:
    'One dependable place for classes, deadlines, Blackboard items, notes and announcements.',
  applicationName: 'School OS',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'School OS',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: '/icons/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  // Safe-area insets only resolve when the viewport covers the display cutout.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf6f2' },
    { media: '(prefers-color-scheme: dark)', color: '#16110f' },
  ],
};

/**
 * Applies the stored theme before first paint.
 *
 * Without this the page renders in the light palette and then flips, which is
 * both ugly and, at 1am in a dark room, genuinely unpleasant. Kept tiny and
 * inline; it reads only localStorage, never network state.
 */
const themeBootstrap = `
(function () {
  try {
    var mode = localStorage.getItem('mos.theme') || 'system';
    var density = localStorage.getItem('mos.density') || 'comfortable';
    var dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-density', density);
    var custom = localStorage.getItem('mos.themeTokens');
    if (custom) {
      var tokens = JSON.parse(custom);
      for (var key in tokens) {
        if (/^--c-[a-z0-9-]+$/.test(key) && /^#[0-9a-fA-F]{6}$/.test(tokens[key])) {
          root.style.setProperty(key, tokens[key]);
        }
      }
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" data-density="comfortable" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-brand focus:px-4 focus:py-2 focus:text-brand-ink"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
