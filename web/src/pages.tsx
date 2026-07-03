import { Link, Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { AuthForm } from '@/components/AuthForm'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { NotificationBell } from '@/components/NotificationBell'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { isAdmin } from '@/lib/roles'
import { useAuth } from '@/lib/use-auth'
import { useRealtime } from '@/lib/use-realtime'

const navLinkClass = cn(
  buttonVariants({ variant: 'ghost', size: 'sm' }),
  'text-muted-foreground data-[status=active]:bg-secondary data-[status=active]:text-secondary-foreground data-[status=active]:hover:bg-secondary/80 data-[status=active]:hover:text-secondary-foreground'
)

export function RootLayout() {
  const auth = useAuth()
  const showComp = isAdmin(auth.user)
  const { t } = useTranslation(['navigation', 'common'])
  // Open the SSE stream once for the whole app; the hook is a no-op when the
  // user isn't authenticated yet.
  useRealtime()

  return (
    <main className="min-h-svh overflow-x-hidden bg-background text-foreground">
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center gap-3 px-5 py-3">
          <Typography asChild variant="h6">
            <Link to="/">{t('common:appName')}</Link>
          </Typography>
          <nav
            className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2"
            aria-label={t('navigation:nav.primary')}
          >
            <Typography asChild variant="control" tone="muted">
              <Link to="/" className={navLinkClass}>
                {t('navigation:nav.auth')}
              </Link>
            </Typography>
            <Typography asChild variant="control" tone="muted">
              <Link to="/app" className={navLinkClass}>
                {t('navigation:nav.app')}
              </Link>
            </Typography>
            <Typography asChild variant="control" tone="muted">
              <Link to="/requisitions" className={navLinkClass}>
                {t('navigation:nav.requisitions')}
              </Link>
            </Typography>
            <Typography asChild variant="control" tone="muted">
              <Link to="/vacancies" className={navLinkClass}>
                {t('navigation:nav.vacancies')}
              </Link>
            </Typography>
            <Typography asChild variant="control" tone="muted">
              <Link to="/candidates" className={navLinkClass}>
                {t('navigation:nav.candidates')}
              </Link>
            </Typography>
            <Typography asChild variant="control" tone="muted">
              <Link to="/applications" className={navLinkClass}>
                {t('navigation:nav.applications')}
              </Link>
            </Typography>
            {showComp && (
              <Typography asChild variant="control" tone="muted">
                <Link to="/comp" className={navLinkClass}>
                  {t('navigation:nav.comp')}
                </Link>
              </Typography>
            )}
            {showComp && (
              <Typography asChild variant="control" tone="muted">
                <Link to="/analytics" className={navLinkClass}>
                  {t('navigation:nav.analytics')}
                </Link>
              </Typography>
            )}
            <Typography asChild variant="control" tone="muted">
              <Link to="/engagement" className={navLinkClass}>
                {t('navigation:nav.engagement')}
              </Link>
            </Typography>
            <Typography asChild variant="control" tone="muted">
              <Link to="/inbox" className={navLinkClass}>
                {t('navigation:nav.inbox')}
              </Link>
            </Typography>
            <Typography asChild variant="control" tone="muted">
              <Link to="/admin/users" className={navLinkClass}>
                {t('navigation:nav.admin')}
              </Link>
            </Typography>
            {showComp && (
              <Typography asChild variant="control" tone="muted">
                <Link to="/admin/org-units" className={navLinkClass}>
                  {t('navigation:nav.orgUnits')}
                </Link>
              </Typography>
            )}
            <Typography asChild variant="control" tone="muted">
              <Link to="/admin/integrations/hh" className={navLinkClass}>
                {t('navigation:nav.hh')}
              </Link>
            </Typography>
            <Typography asChild variant="control" tone="muted">
              <Link to="/settings/integrations" className={navLinkClass}>
                {t('navigation:nav.integrations')}
              </Link>
            </Typography>
            <Typography asChild variant="control" tone="muted">
              <Link to="/selection/dashboard" className={navLinkClass}>
                {t('navigation:nav.selection')}
              </Link>
            </Typography>
          </nav>
          <LanguageSwitcher />
          {auth.isAuthenticated && <NotificationBell />}
          {auth.isAuthenticated && (
            <Button type="button" variant="outline" size="sm" onClick={() => void auth.logout()}>
              {t('common:actions.logout')}
            </Button>
          )}
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl">
        <Outlet />
      </div>
    </main>
  )
}

export function HomePage() {
  const auth = useAuth()
  const { t } = useTranslation(['common', 'auth'])

  if (auth.isBootstrapping) {
    return <LoadingState />
  }

  if (auth.user) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-16">
        <Badge variant="outline" className="w-fit">
          {t('auth:session.authenticatedStarter')}
        </Badge>
        <div className="grid max-w-3xl gap-4">
          <Typography variant="h1">{t('common:states.sessionActive')}</Typography>
          <Typography className="max-w-2xl" tone="muted">
            {t('common:states.loggedInAs')}{' '}
            <Typography as="strong" variant="emphasis" tone="default">
              {auth.user.email}
            </Typography>
            .
          </Typography>
        </div>
        <Button asChild size="lg" className="w-fit">
          <Link to="/app">{t('common:actions.openApp')}</Link>
        </Button>
      </section>
    )
  }

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-12 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
      <div className="grid gap-5">
        <Badge variant="outline" className="w-fit">
          {t('auth:starter.badge')}
        </Badge>
        <Typography className="max-w-3xl" variant="h1">
          {t('auth:starter.headline')}
        </Typography>
        <Typography className="max-w-2xl" tone="muted">
          {t('auth:starter.description')}
        </Typography>
      </div>
      <AuthForm />
    </section>
  )
}

export function AppPage() {
  const auth = useAuth()
  const { t } = useTranslation(['common', 'auth'])

  if (auth.isBootstrapping) {
    return <LoadingState />
  }

  if (!auth.user) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-16">
        <Badge variant="outline" className="w-fit">
          {t('auth:protected.badge')}
        </Badge>
        <div className="grid max-w-3xl gap-4">
          <Typography variant="h1">{t('common:states.loginRequired')}</Typography>
          <Typography className="max-w-2xl" tone="muted">
            {t('common:states.loginRequiredHint')}
          </Typography>
        </div>
        <Button asChild size="lg" className="w-fit">
          <Link to="/">{t('common:actions.goToAuth')}</Link>
        </Button>
      </section>
    )
  }

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="grid gap-3">
        <Badge variant="outline" className="w-fit">
          {t('auth:protected.currentUser')}
        </Badge>
        <Typography variant="h1">
          {auth.user.displayName ?? auth.user.email}
        </Typography>
        <Typography tone="muted">{auth.user.email}</Typography>
      </div>

      <Separator />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t('common:labels.userId')}</CardTitle>
            <CardDescription wrap="break">{auth.user.id}</CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>{t('common:labels.created')}</CardTitle>
            <CardDescription>{new Date(auth.user.createdAt).toLocaleString()}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </section>
  )
}

function LoadingState() {
  const { t } = useTranslation('common')
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-16">
      <Card className="w-fit">
        <CardContent className="flex items-center gap-3">
          <Spinner />
          <Typography variant="bodySm" tone="muted">
            {t('states.checkingSession')}
          </Typography>
        </CardContent>
      </Card>
    </section>
  )
}
