/**
 * Phase 8 — /settings/integrations
 *
 * Owner / hr_admin overview of every external integration: Telegram,
 * Email, HH.ru, and the additional job boards (СберПодбор, Avito Jobs,
 * Работа.ру). One round-trip to `/api/integrations/status` powers the
 * whole page.
 */
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type { IntegrationsStatus } from "@web-app-demo/contracts"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Typography } from "@/components/ui/typography"
import { useAuth } from "@/lib/use-auth"
import { cn } from "@/lib/utils"

const JOB_BOARD_LABELS: Record<string, string> = {
  sber_podbor: "СберПодбор",
  avito_jobs: "Avito Jobs",
  rabota_ru: "Работа.ру",
}

function StatusBadge({ enabled, configured }: { enabled: boolean; configured: boolean }) {
  const { t } = useTranslation("settings")
  if (enabled && configured) {
    return <Badge variant="default">{t("status.enabled")}</Badge>
  }
  if (enabled && !configured) {
    return <Badge variant="destructive">{t("status.needsConfig")}</Badge>
  }
  return <Badge variant="outline">{t("status.disabled")}</Badge>
}

function LoginRequired() {
  const { t } = useTranslation(["settings", "common"])
  return (
    <section className="mx-auto grid w-full max-w-6xl gap-4 px-5 py-16">
      <Badge variant="outline" className="w-fit">{t("settings:loginRequired")}</Badge>
      <Typography variant="h2">{t("settings:signInPrompt")}</Typography>
      <Link to="/" className={cn(buttonVariants({ size: "lg" }), "w-fit")}>
        {t("common:actions.goToAuth")}
      </Link>
    </section>
  )
}

export function SettingsIntegrationsPage() {
  const { user } = useAuth()
  if (!user) return <LoginRequired />
  return <SettingsIntegrations />
}

function SettingsIntegrations() {
  const { api, user } = useAuth()
  const { t } = useTranslation("settings")
  const statusQuery = useQuery({
    queryKey: ["settings", "integrations"],
    queryFn: () => api.getIntegrationsStatus(),
    enabled: Boolean(user),
  })

  if (statusQuery.isLoading) {
    return (
      <section className="mx-auto grid w-full max-w-5xl gap-4 px-5 py-10">
        <div className="flex items-center gap-2">
          <Spinner aria-hidden />
          <Typography tone="muted">{t("loading")}</Typography>
        </div>
      </section>
    )
  }

  if (statusQuery.isError || !statusQuery.data) {
    return (
      <section className="mx-auto grid w-full max-w-5xl gap-4 px-5 py-10">
        <Typography variant="h2">{t("title")}</Typography>
        <Typography tone="muted">{t("loadFailed")}</Typography>
      </section>
    )
  }

  const data: IntegrationsStatus = statusQuery.data

  return (
    <section className="mx-auto grid w-full max-w-5xl gap-6 px-5 py-10">
      <header className="grid gap-2">
        <Typography variant="h2">{t("title")}</Typography>
        <Typography tone="muted">{t("intro")}</Typography>
      </header>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Telegram</CardTitle>
            <CardDescription>
              {t("telegram.activeLinks", { count: data.telegram.activeLinks })}
            </CardDescription>
          </div>
          <StatusBadge
            enabled={data.telegram.enabled}
            configured={data.telegram.configured}
          />
        </CardHeader>
        <CardContent>
          <Typography tone="muted" variant="bodySm">
            {t("telegram.webhook")}: <code>/api/integrations/telegram/webhook</code>.{" "}
            {t("telegram.link")}: <code>/api/integrations/telegram/link?token=…</code>
          </Typography>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>{t("email.title")}</CardTitle>
            <CardDescription>{t("email.from", { from: data.email.from ?? "—" })}</CardDescription>
          </div>
          <StatusBadge
            enabled={data.email.enabled}
            configured={data.email.configured}
          />
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>HH.ru</CardTitle>
            <CardDescription>
              {data.hh.connected ? t("status.connected") : t("status.notConnected")} ·{" "}
              {t("hh.lastSync", {
                when: data.hh.lastSyncAt ? new Date(data.hh.lastSyncAt).toLocaleString() : "—",
              })}
            </CardDescription>
          </div>
          <StatusBadge enabled={data.hh.enabled} configured={data.hh.configured} />
        </CardHeader>
        <CardContent>
          <Link to="/admin/integrations/hh" className={buttonVariants({ size: "sm" })}>
            {t("hh.openPanel")}
          </Link>
        </CardContent>
      </Card>

      {data.jobBoards.map((board) => (
        <Card key={board.board}>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>{JOB_BOARD_LABELS[board.board] ?? board.board}</CardTitle>
              <CardDescription>
                {t("jobBoards.published", { count: board.publishedVacancies })}
                {board.reason ? ` · ${board.reason}` : ""}
              </CardDescription>
            </div>
            <StatusBadge enabled={board.enabled} configured={board.configured} />
          </CardHeader>
        </Card>
      ))}
    </section>
  )
}
