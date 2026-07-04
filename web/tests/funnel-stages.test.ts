import { expect, describe, test } from "bun:test"
import type { FunnelStageEntry, TenantSettings } from "@web-app-demo/contracts"

import { resolveFunnelStages, APPLICATION_STAGES } from "../src/lib/funnel-stages"
import { buildFunnelStagePatch, stageRowsFromSettings } from "../src/pages/settings"

// ─── resolveFunnelStages ──────────────────────────────────────────────────────

describe("resolveFunnelStages", () => {
  test("null config → canonical order, no labels, not hidden", () => {
    const result = resolveFunnelStages(null)
    expect(result.map((d) => d.stage)).toEqual([...APPLICATION_STAGES])
    expect(result.every((d) => d.label === null)).toBe(true)
    expect(result.every((d) => !d.hidden)).toBe(true)
  })

  test("undefined config → same as null (canonical defaults)", () => {
    const result = resolveFunnelStages(undefined)
    expect(result.map((d) => d.stage)).toEqual([...APPLICATION_STAGES])
  })

  test("empty array → canonical defaults", () => {
    const result = resolveFunnelStages([])
    expect(result.map((d) => d.stage)).toEqual([...APPLICATION_STAGES])
  })

  test("custom order is respected", () => {
    const config: FunnelStageEntry[] = [
      { stage: "rejected", order: 0 },
      { stage: "new", order: 1 },
    ]
    const result = resolveFunnelStages(config)
    expect(result[0].stage).toBe("rejected")
    expect(result[1].stage).toBe("new")
  })

  test("label override is returned for configured stages", () => {
    const config: FunnelStageEntry[] = [
      { stage: "tech", label: "Technical Interview", order: 2 },
    ]
    const result = resolveFunnelStages(config)
    const techDescriptor = result.find((d) => d.stage === "tech")
    expect(techDescriptor?.label).toBe("Technical Interview")
  })

  test("unconfigured stages have null label", () => {
    const config: FunnelStageEntry[] = [{ stage: "new", order: 0 }]
    const result = resolveFunnelStages(config)
    const screenDescriptor = result.find((d) => d.stage === "screen")
    expect(screenDescriptor?.label).toBeNull()
  })

  test("hidden stages are present in list with hidden: true", () => {
    const config: FunnelStageEntry[] = [{ stage: "final", order: 3, hidden: true }]
    const result = resolveFunnelStages(config)
    const finalDescriptor = result.find((d) => d.stage === "final")
    expect(finalDescriptor?.hidden).toBe(true)
  })

  test("non-hidden stages have hidden: false by default", () => {
    const config: FunnelStageEntry[] = [{ stage: "screen", order: 1 }]
    const result = resolveFunnelStages(config)
    const screenDescriptor = result.find((d) => d.stage === "screen")
    expect(screenDescriptor?.hidden).toBe(false)
  })

  test("returns all 7 stages regardless of config coverage", () => {
    const config: FunnelStageEntry[] = [{ stage: "new", order: 0 }]
    const result = resolveFunnelStages(config)
    expect(result).toHaveLength(APPLICATION_STAGES.length)
    const stages = result.map((d) => d.stage)
    for (const s of APPLICATION_STAGES) {
      expect(stages).toContain(s)
    }
  })
})

// ─── buildFunnelStagePatch ────────────────────────────────────────────────────

const baseTenantSettings: TenantSettings = {
  tenantId: "tenant-1",
  name: "Acme HR",
  slug: "acme-hr",
  subdomain: "acme",
  logoUrl: null,
  primaryColor: null,
  timezone: "Europe/Moscow",
  locale: "ru",
  featureFlags: {},
  scoringWeights: null,
  pipelineThresholds: null,
}

describe("buildFunnelStagePatch", () => {
  test("valid rows produce correct funnelStageConfig payload", () => {
    const rows = APPLICATION_STAGES.map((stage, idx) => ({
      stage,
      label: stage === "tech" ? "Technical Interview" : "",
      order: String(idx),
      hidden: stage === "final",
    }))

    const result = buildFunnelStagePatch(rows)

    expect(result.errorKey).toBeNull()
    expect(result.patch).not.toBeNull()

    const techEntry = result.patch!.funnelStageConfig!.find((e) => e.stage === "tech")
    expect(techEntry?.label).toBe("Technical Interview")

    const finalEntry = result.patch!.funnelStageConfig!.find((e) => e.stage === "final")
    expect(finalEntry?.hidden).toBe(true)

    const newEntry = result.patch!.funnelStageConfig!.find((e) => e.stage === "new")
    expect(newEntry?.label).toBeUndefined()
    expect(newEntry?.hidden).toBeUndefined()
  })

  test("rows without label produce entries without label key", () => {
    const rows = APPLICATION_STAGES.map((stage, idx) => ({
      stage,
      label: "",
      order: String(idx),
      hidden: false,
    }))
    const result = buildFunnelStagePatch(rows)
    expect(result.patch?.funnelStageConfig?.every((e) => e.label === undefined)).toBe(true)
  })

  test("rows without hidden produce entries without hidden key", () => {
    const rows = APPLICATION_STAGES.map((stage, idx) => ({
      stage,
      label: "",
      order: String(idx),
      hidden: false,
    }))
    const result = buildFunnelStagePatch(rows)
    expect(result.patch?.funnelStageConfig?.every((e) => e.hidden === undefined)).toBe(true)
  })
})

// ─── stageRowsFromSettings ────────────────────────────────────────────────────

describe("stageRowsFromSettings", () => {
  test("null funnelStageConfig → canonical order with empty labels and hidden false", () => {
    const rows = stageRowsFromSettings({ ...baseTenantSettings, funnelStageConfig: undefined })
    expect(rows.map((r) => r.stage)).toEqual([...APPLICATION_STAGES])
    expect(rows.every((r) => r.label === "")).toBe(true)
    expect(rows.every((r) => !r.hidden)).toBe(true)
  })

  test("funnelStageConfig label override is reflected in rows", () => {
    const settings: TenantSettings = {
      ...baseTenantSettings,
      funnelStageConfig: [{ stage: "tech", label: "Tech Round", order: 2 }],
    }
    const rows = stageRowsFromSettings(settings)
    const techRow = rows.find((r) => r.stage === "tech")
    expect(techRow?.label).toBe("Tech Round")
  })

  test("funnelStageConfig hidden is reflected in rows", () => {
    const settings: TenantSettings = {
      ...baseTenantSettings,
      funnelStageConfig: [{ stage: "hired", order: 5, hidden: true }],
    }
    const rows = stageRowsFromSettings(settings)
    const hiredRow = rows.find((r) => r.stage === "hired")
    expect(hiredRow?.hidden).toBe(true)
  })
})
