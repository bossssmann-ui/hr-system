/**
 * Phase 8 — /settings/integrations
 *
 * Owner / hr_admin overview of every external integration: Telegram,
 * Email, HH.ru, and the additional job boards (СберПодбор, Avito Jobs,
 * Работа.ру). One round-trip to `/api/integrations/status` powers the
 * whole page.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type {
  ApplicationStage,
  FunnelStageEntry,
  IntegrationsStatus,
  TenantSettings,
  UpdateTenantSettingsRequest,
} from "@web-app-demo/contracts"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ApiRequestError } from "@/lib/api"
import { APPLICATION_STAGES, resolveFunnelStages } from "@/lib/funnel-stages"
import { isAdmin } from "@/lib/roles"
import { Spinner } from "@/components/ui/spinner"
import { Typography } from "@/components/ui/typography"
import { useAuth } from "@/lib/use-auth"
import { cn } from "@/lib/utils"

const JOB_BOARD_LABELS: Record<string, string> = {
  sber_podbor: "СберПодбор",
  avito_jobs: "Avito Jobs",
  rabota_ru: "Работа.ру",
}

const SCORING_WEIGHT_KEYS = ["resume", "selection", "assessment", "retention"] as const

type ScoringWeightKey = (typeof SCORING_WEIGHT_KEYS)[number]

type PipelineScoringForm = {
  autoSelection: string
  autoReject: string
  weights: Record<ScoringWeightKey, string>
}

function parseNumberOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function parseThresholds(
  autoSelection: string,
  autoReject: string,
): { value: { autoSelection: number; autoReject: number } | null; errorKey: string | null } {
  const hasAutoSelection = autoSelection.trim().length > 0
  const hasAutoReject = autoReject.trim().length > 0
  const parsedAutoSelection = parseNumberOrNull(autoSelection)
  const parsedAutoReject = parseNumberOrNull(autoReject)

  if (!hasAutoSelection && !hasAutoReject) {
    return { value: null, errorKey: null }
  }

  if (!hasAutoSelection || !hasAutoReject) {
    return { value: null, errorKey: "pipeline.validation.thresholdsBothOrEmpty" }
  }

  if (parsedAutoSelection === null || parsedAutoReject === null) {
    return { value: null, errorKey: "pipeline.validation.thresholdsRange" }
  }

  if (
    parsedAutoSelection < 0 ||
    parsedAutoSelection > 100 ||
    parsedAutoReject < 0 ||
    parsedAutoReject > 100
  ) {
    return { value: null, errorKey: "pipeline.validation.thresholdsRange" }
  }

  if (parsedAutoReject > parsedAutoSelection) {
    return { value: null, errorKey: "pipeline.validation.thresholdsOrder" }
  }

  return {
    value: {
      autoSelection: parsedAutoSelection,
      autoReject: parsedAutoReject,
    },
    errorKey: null,
  }
}

function parseScoringWeights(weights: Record<ScoringWeightKey, string>): {
  value: Record<ScoringWeightKey, number> | null
  errorKey: string | null
} {
  const parsedWeights = {} as Record<ScoringWeightKey, number>
  for (const key of SCORING_WEIGHT_KEYS) {
    const parsed = parseNumberOrNull(weights[key])
    if (parsed === null) {
      return { value: null, errorKey: "pipeline.validation.weightsRequired" }
    }
    parsedWeights[key] = parsed
  }
  return { value: parsedWeights, errorKey: null }
}

export function tenantSettingsToPipelineForm(settings: TenantSettings): PipelineScoringForm {
  return {
    autoSelection: settings.pipelineThresholds?.autoSelection?.toString() ?? "",
    autoReject: settings.pipelineThresholds?.autoReject?.toString() ?? "",
    weights: {
      resume: settings.scoringWeights?.resume?.toString() ?? "",
      selection: settings.scoringWeights?.selection?.toString() ?? "",
      assessment: settings.scoringWeights?.assessment?.toString() ?? "",
      retention: settings.scoringWeights?.retention?.toString() ?? "",
    },
  }
}

export function buildTenantSettingsPatch(form: PipelineScoringForm): {
  patch: Pick<UpdateTenantSettingsRequest, "pipelineThresholds" | "scoringWeights"> | null
  errorKey: string | null
} {
  const thresholds = parseThresholds(form.autoSelection, form.autoReject)
  if (thresholds.errorKey) {
    return { patch: null, errorKey: thresholds.errorKey }
  }

  const scoringWeights = parseScoringWeights(form.weights)
  if (scoringWeights.errorKey) {
    return { patch: null, errorKey: scoringWeights.errorKey }
  }

  return {
    patch: {
      pipelineThresholds: thresholds.value,
      scoringWeights: scoringWeights.value,
    },
    errorKey: null,
  }
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

      {isAdmin(user) && <PipelineScoringSettingsCard />}
      {isAdmin(user) && <FunnelStageEditorCard />}

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

function PipelineScoringSettingsCard() {
  const { api } = useAuth()
  const { t } = useTranslation("settings")
  const queryClient = useQueryClient()
  const tenantSettingsQuery = useQuery({
    queryKey: ["settings", "tenant"],
    queryFn: () => api.getTenantSettings(),
  })

  const [form, setForm] = useState<PipelineScoringForm>({
    autoSelection: "",
    autoReject: "",
    weights: {
      resume: "",
      selection: "",
      assessment: "",
      retention: "",
    },
  })
  const [submitErrorKey, setSubmitErrorKey] = useState<string | null>(null)

  useEffect(() => {
    if (!tenantSettingsQuery.data) return
    setForm(tenantSettingsToPipelineForm(tenantSettingsQuery.data))
    setSubmitErrorKey(null)
  }, [tenantSettingsQuery.data])

  const thresholdsValidation = useMemo(
    () => parseThresholds(form.autoSelection, form.autoReject),
    [form.autoSelection, form.autoReject],
  )

  const saveMutation = useMutation({
    mutationFn: (patch: Pick<UpdateTenantSettingsRequest, "pipelineThresholds" | "scoringWeights">) =>
      api.updateTenantSettings(patch),
    onSuccess: () => {
      setSubmitErrorKey(null)
      toast.success(t("pipeline.saveSuccess"))
      void queryClient.invalidateQueries({ queryKey: ["settings", "tenant"] })
    },
    onError: (error) => {
      const message = error instanceof ApiRequestError ? error.message : t("pipeline.saveFailed")
      toast.error(message)
    },
  })

  function updateWeightField(key: ScoringWeightKey, value: string) {
    setForm((prev) => ({
      ...prev,
      weights: {
        ...prev.weights,
        [key]: value,
      },
    }))
  }

  function handleSubmit() {
    const payload = buildTenantSettingsPatch(form)
    if (!payload.patch) {
      setSubmitErrorKey(payload.errorKey)
      return
    }
    setSubmitErrorKey(null)
    saveMutation.mutate(payload.patch)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("pipeline.title")}</CardTitle>
        <CardDescription>{t("pipeline.description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {tenantSettingsQuery.isLoading ? (
          <div className="flex items-center gap-2">
            <Spinner aria-hidden />
            <Typography tone="muted">{t("loading")}</Typography>
          </div>
        ) : tenantSettingsQuery.isError ? (
          <Typography tone="destructive">{t("pipeline.loadFailed")}</Typography>
        ) : !tenantSettingsQuery.data ? (
          <Typography tone="muted">{t("pipeline.empty")}</Typography>
        ) : (
          <>
            <div className="grid gap-3">
              <Typography variant="h6">{t("pipeline.thresholds.title")}</Typography>
              <Typography tone="muted" variant="bodySm">
                {t("pipeline.thresholds.hint")}
              </Typography>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <Typography variant="label">{t("pipeline.thresholds.autoSelection")}</Typography>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={form.autoSelection}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, autoSelection: event.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1">
                  <Typography variant="label">{t("pipeline.thresholds.autoReject")}</Typography>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={form.autoReject}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, autoReject: event.target.value }))
                    }
                  />
                </label>
              </div>
              {thresholdsValidation.errorKey ? (
                <Typography tone="destructive" variant="bodySm">
                  {t(thresholdsValidation.errorKey)}
                </Typography>
              ) : null}
            </div>

            <div className="grid gap-3">
              <Typography variant="h6">{t("pipeline.weights.title")}</Typography>
              <div className="grid gap-3 sm:grid-cols-2">
                {SCORING_WEIGHT_KEYS.map((key) => (
                  <label className="grid gap-1" key={key}>
                    <Typography variant="label">{t(`pipeline.weights.${key}`)}</Typography>
                    <Input
                      type="number"
                      step="any"
                      value={form.weights[key]}
                      onChange={(event) => updateWeightField(key, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            </div>

            {submitErrorKey ? (
              <Typography tone="destructive" variant="bodySm">
                {t(submitErrorKey)}
              </Typography>
            ) : null}

            <div>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={saveMutation.isPending || Boolean(thresholdsValidation.errorKey)}
              >
                {t("pipeline.actions.save")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Funnel Stage Editor ──────────────────────────────────────────────────────

export type FunnelStageRow = {
  stage: ApplicationStage
  label: string
  order: string
  hidden: boolean
}

export function stageRowsFromSettings(settings: TenantSettings): FunnelStageRow[] {
  const descriptors = resolveFunnelStages(settings.funnelStageConfig ?? null)
  return descriptors.map((d) => ({
    stage: d.stage,
    label: d.label ?? "",
    order: String(d.order),
    hidden: d.hidden,
  }))
}

export function buildFunnelStagePatch(rows: FunnelStageRow[]): {
  patch: Pick<UpdateTenantSettingsRequest, "funnelStageConfig"> | null
  errorKey: string | null
} {
  const stages = rows.map((r) => r.stage)
  if (stages.length !== new Set(stages).size) {
    return { patch: null, errorKey: "funnelStages.validation.duplicateStages" }
  }

  const config: FunnelStageEntry[] = rows.map((row, idx) => {
    const order = Number(row.order)
    return {
      stage: row.stage,
      ...(row.label.trim() ? { label: row.label.trim() } : {}),
      order: Number.isFinite(order) ? order : idx,
      ...(row.hidden ? { hidden: true } : {}),
    }
  })

  return { patch: { funnelStageConfig: config }, errorKey: null }
}

function FunnelStageEditorCard() {
  const { api } = useAuth()
  const { t } = useTranslation("settings")
  const queryClient = useQueryClient()

  const tenantSettingsQuery = useQuery({
    queryKey: ["settings", "tenant"],
    queryFn: () => api.getTenantSettings(),
  })

  const [rows, setRows] = useState<FunnelStageRow[]>(() =>
    APPLICATION_STAGES.map((stage, idx) => ({ stage, label: "", order: String(idx), hidden: false })),
  )
  const [submitErrorKey, setSubmitErrorKey] = useState<string | null>(null)

  useEffect(() => {
    if (!tenantSettingsQuery.data) return
    setRows(stageRowsFromSettings(tenantSettingsQuery.data))
    setSubmitErrorKey(null)
  }, [tenantSettingsQuery.data])

  const saveMutation = useMutation({
    mutationFn: (patch: Pick<UpdateTenantSettingsRequest, "funnelStageConfig">) =>
      api.updateTenantSettings(patch),
    onSuccess: () => {
      setSubmitErrorKey(null)
      toast.success(t("funnelStages.saveSuccess"))
      void queryClient.invalidateQueries({ queryKey: ["settings", "tenant"] })
    },
    onError: (error) => {
      const message = error instanceof ApiRequestError ? error.message : t("funnelStages.saveFailed")
      toast.error(message)
    },
  })

  function updateRow(idx: number, field: keyof FunnelStageRow, value: string | boolean) {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  function handleSubmit() {
    const payload = buildFunnelStagePatch(rows)
    if (!payload.patch) {
      setSubmitErrorKey(payload.errorKey)
      return
    }
    setSubmitErrorKey(null)
    saveMutation.mutate(payload.patch)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("funnelStages.title")}</CardTitle>
        <CardDescription>{t("funnelStages.description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {tenantSettingsQuery.isLoading ? (
          <div className="flex items-center gap-2">
            <Spinner aria-hidden />
            <Typography tone="muted">{t("loading")}</Typography>
          </div>
        ) : tenantSettingsQuery.isError ? (
          <Typography tone="destructive">{t("funnelStages.loadFailed")}</Typography>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 pr-4 font-medium">{t("funnelStages.columns.stage")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("funnelStages.columns.label")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("funnelStages.columns.order")}</th>
                    <th className="pb-2 font-medium">{t("funnelStages.columns.hidden")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={row.stage} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <Typography variant="bodySm" className="font-mono">{row.stage}</Typography>
                      </td>
                      <td className="py-2 pr-4">
                        <Input
                          className="h-8 text-sm"
                          value={row.label}
                          placeholder={t("funnelStages.columns.labelPlaceholder")}
                          onChange={(e) => updateRow(idx, "label", e.target.value)}
                          data-testid={`funnel-stage-label-${row.stage}`}
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <Input
                          className="h-8 w-20 text-sm"
                          type="number"
                          value={row.order}
                          onChange={(e) => updateRow(idx, "order", e.target.value)}
                          data-testid={`funnel-stage-order-${row.stage}`}
                        />
                      </td>
                      <td className="py-2">
                        <input
                          type="checkbox"
                          checked={row.hidden}
                          onChange={(e) => updateRow(idx, "hidden", e.target.checked)}
                          className={cn("h-4 w-4 rounded border-input")}
                          data-testid={`funnel-stage-hidden-${row.stage}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {submitErrorKey ? (
              <Typography tone="destructive" variant="bodySm">
                {t(submitErrorKey)}
              </Typography>
            ) : null}

            <div>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={saveMutation.isPending}
                data-testid="funnel-stages-save"
              >
                {t("funnelStages.actions.save")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
