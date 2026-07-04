import { describe, expect, test } from "bun:test"
import type { TenantSettings } from "@web-app-demo/contracts"

import { buildTenantSettingsPatch, tenantSettingsToPipelineForm } from "../src/pages/settings"

const tenantSettingsFixture: TenantSettings = {
  tenantId: "tenant-1",
  name: "Acme HR",
  slug: "acme-hr",
  subdomain: "acme",
  logoUrl: null,
  primaryColor: null,
  timezone: "Europe/Moscow",
  locale: "ru",
  featureFlags: {},
  scoringWeights: {
    resume: 0.5,
    selection: 0.2,
    assessment: 0.2,
    retention: 0.1,
  },
  pipelineThresholds: {
    autoSelection: 85,
    autoReject: 20,
  },
}

describe("settings pipeline helpers", () => {
  test("tenant settings map into form values", () => {
    const form = tenantSettingsToPipelineForm(tenantSettingsFixture)

    expect(form.autoSelection).toBe("85")
    expect(form.autoReject).toBe("20")
    expect(form.weights.resume).toBe("0.5")
    expect(form.weights.selection).toBe("0.2")
    expect(form.weights.assessment).toBe("0.2")
    expect(form.weights.retention).toBe("0.1")
  })

  test("invalid thresholds block save payload generation", () => {
    const form = tenantSettingsToPipelineForm(tenantSettingsFixture)
    form.autoSelection = "40"
    form.autoReject = "80"

    const result = buildTenantSettingsPatch(form)

    expect(result.patch).toBeNull()
    expect(result.errorKey).toBe("pipeline.validation.thresholdsOrder")
  })

  test("valid values create tenant settings patch payload", () => {
    const form = tenantSettingsToPipelineForm(tenantSettingsFixture)
    form.autoSelection = "90"
    form.autoReject = "30"
    form.weights.resume = "0.6"
    form.weights.selection = "0.15"
    form.weights.assessment = "0.15"
    form.weights.retention = "0.1"

    const result = buildTenantSettingsPatch(form)

    expect(result.errorKey).toBeNull()
    expect(result.patch).toEqual({
      pipelineThresholds: {
        autoSelection: 90,
        autoReject: 30,
      },
      scoringWeights: {
        resume: 0.6,
        selection: 0.15,
        assessment: 0.15,
        retention: 0.1,
      },
    })
  })
})
