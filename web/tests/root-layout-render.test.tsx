import { expect, mock, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('@tanstack/react-router', () => ({
  Link: ({ to, className, children }: { to: string; className?: string; children?: React.ReactNode }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  Outlet: () => <div data-slot="outlet" />,
}))

mock.module('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init() {} },
  useTranslation: () => ({ t: (key: string) => key }),
}))

mock.module('../src/lib/use-auth', () => ({
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    isBootstrapping: false,
    logout: async () => {},
  }),
}))

mock.module('../src/lib/use-realtime', () => ({
  useRealtime: () => {},
}))

mock.module('../src/lib/roles', () => ({
  isAdmin: () => false,
}))

mock.module('../src/components/LanguageSwitcher', () => ({
  LanguageSwitcher: () => <div data-slot="language-switcher" />,
}))

mock.module('../src/components/NotificationBell', () => ({
  NotificationBell: () => <div data-slot="notification-bell" />,
}))

test('RootLayout wraps navigation and outlet in centered, non-overflowing containers', async () => {
  const { RootLayout } = await import('../src/pages')
  const markup = renderToStaticMarkup(<RootLayout />)

  expect(markup).toContain('flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2')
  expect(markup).toContain('mx-auto w-full max-w-6xl')
  expect(markup).toContain('data-slot="outlet"')
})
