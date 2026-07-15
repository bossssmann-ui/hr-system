import type {
  ApplicationStage,
  FunnelStageEntry,
  TenantSettings,
  UpdateTenantSettingsRequest,
} from "@web-app-demo/contracts"

import { APPLICATION_STAGES, resolveFunnelStages } from "@/lib/funnel-stages"

const SCORING_WEIGHT_KEYS = ["resume", "selection", "assessment", "retention"] as const

export type ScoringWeightKey = (typeof SCORING_WEIGHT_KEYS)[number]

export { SCORING_WEIGHT_KEYS }

export const PIPELINE_FLAG_KEYS = ["autoSelection", "autoAssessment", "compositeScore", "recruiterNotifications"] as const

export type PipelineFlagKey = (typeof PIPELINE_FLAG_KEYS)[number]

export type PipelineScoringForm = {
  autoSelection: string
  autoReject: string
  weights: Record<ScoringWeightKey, string>
  flags: Record<PipelineFlagKey, boolean | null>
}

function parseNumberOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseThresholds(
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
  const flags = settings.featureFlags ?? {}
  return {
    autoSelection: settings.pipelineThresholds?.autoSelection?.toString() ?? "",
    autoReject: settings.pipelineThresholds?.autoReject?.toString() ?? "",
    weights: {
      resume: settings.scoringWeights?.resume?.toString() ?? "",
      selection: settings.scoringWeights?.selection?.toString() ?? "",
      assessment: settings.scoringWeights?.assessment?.toString() ?? "",
      retention: settings.scoringWeights?.retention?.toString() ?? "",
    },
    flags: {
      autoSelection: typeof flags.autoSelection === "boolean" ? flags.autoSelection : null,
      autoAssessment: typeof flags.autoAssessment === "boolean" ? flags.autoAssessment : null,
      compositeScore: typeof flags.compositeScore === "boolean" ? flags.compositeScore : null,
      recruiterNotifications: typeof flags.recruiterNotifications === "boolean" ? flags.recruiterNotifications : null,
    },
  }
}

export function buildTenantSettingsPatch(form: PipelineScoringForm): {
  patch: Pick<UpdateTenantSettingsRequest, "pipelineThresholds" | "scoringWeights" | "featureFlags"> | null
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

  const featureFlags: Record<string, boolean> = {}
  for (const key of PIPELINE_FLAG_KEYS) {
    if (form.flags[key] !== null) {
      featureFlags[key] = form.flags[key] as boolean
    }
  }

  return {
    patch: {
      pipelineThresholds: thresholds.value,
      scoringWeights: scoringWeights.value,
      featureFlags,
    },
    errorKey: null,
  }
}

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

export function defaultFunnelStageRows(): FunnelStageRow[] {
  return APPLICATION_STAGES.map((stage, idx) => ({
    stage,
    label: "",
    order: String(idx),
    hidden: false,
  }))
}
