import { expect, mock, test } from "bun:test"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { TFunction } from "i18next"
import type { Application } from "@web-app-demo/contracts"

mock.module("../src/components/ui/accordion", () => ({
  Accordion: ({ children }: { children?: React.ReactNode }) => <div data-slot="accordion">{children}</div>,
  AccordionItem: ({ children }: { children?: React.ReactNode }) => <div data-slot="accordion-item">{children}</div>,
  AccordionTrigger: ({ children }: { children?: React.ReactNode }) => <button type="button" data-slot="accordion-trigger">{children}</button>,
  AccordionContent: ({ children }: { children?: React.ReactNode }) => <div data-slot="accordion-content">{children}</div>,
}))

const t = ((key: string, options?: Record<string, unknown>) => {
  const templates: Record<string, string> = {
    "applications.composite.badge": "Score: {{score}}",
    "applications.composite.title": "Composite score",
    "applications.composite.breakdownTitle": "Breakdown",
    "applications.composite.resume": "Resume",
    "applications.composite.selection": "Selection",
    "applications.composite.selectionStages": "Stage 1: {{stage1}} · Stage 2: {{stage2}} · Stage 3: {{stage3}} · Stage 4: {{stage4}} · Total: {{total}}",
    "applications.composite.assessment": "Assessment",
    "applications.composite.assessmentValues": "Score: {{score}} · Trust: {{trust}}",
    "applications.composite.retention": "Retention",
    "applications.composite.weights": "Weights: {{value}}",
    "applications.composite.weightKeys.resume": "Resume",
    "applications.composite.weightKeys.selection": "Selection",
    "applications.composite.weightKeys.assessment": "Assessment",
    "applications.composite.weightKeys.retention": "Retention",
  }
  let value = templates[key] ?? key
  for (const [optionKey, optionValue] of Object.entries(options ?? {})) {
    value = value.replaceAll(`{{${optionKey}}}`, String(optionValue))
  }
  return value
}) as unknown as TFunction

const compositeScore: NonNullable<Application["compositeScore"]> = {
  overall: 82,
  breakdown: {
    resume: 90,
    selection: { stage1: 80, stage2: null, stage3: 75, stage4: null, total: 77 },
    assessment: { score: null, trust: 68 },
    retention: null,
  },
  weights: {
    resume: 0.3,
    selection: 0.4,
    assessment: 0.2,
    retention: 0.1,
  },
  updatedAt: new Date().toISOString(),
}

test("composite score badge renders overall value when score exists", () => {
  const { CompositeScoreBadge } = require("../src/components/ApplicationCompositeScore")
  const html = renderToStaticMarkup(
    <CompositeScoreBadge compositeScore={compositeScore} t={t} />,
  )

  expect(html).toContain("Score: 82")
})

test("composite score badge and detail do not render when score is null", () => {
  const { CompositeScoreBadge, CompositeScoreDetail } = require("../src/components/ApplicationCompositeScore")
  const badgeHtml = renderToStaticMarkup(
    <CompositeScoreBadge compositeScore={null} t={t} />,
  )
  const detailHtml = renderToStaticMarkup(
    <CompositeScoreDetail compositeScore={null} t={t} />,
  )

  expect(badgeHtml).toBe("")
  expect(detailHtml).toBe("")
})

test("composite score detail renders expanded breakdown with values and dashes", () => {
  const { CompositeScoreDetail } = require("../src/components/ApplicationCompositeScore")
  const html = renderToStaticMarkup(
    <CompositeScoreDetail compositeScore={compositeScore} t={t} defaultBreakdownOpen />,
  )

  expect(html).toContain("Composite score")
  expect(html).toContain(">82<")
  expect(html).toContain("Breakdown")
  expect(html).toContain("Resume: 90")
  expect(html).toContain("Stage 1: 80")
  expect(html).toContain("Stage 2: —")
  expect(html).toContain("Score: — · Trust: 68")
  expect(html).toContain("Retention: —")
  expect(html).toContain("Weights: Resume: 0.3 · Selection: 0.4 · Assessment: 0.2 · Retention: 0.1")
})
