import type { Application } from "@web-app-demo/contracts"
import type { TFunction } from "i18next"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Typography } from "@/components/ui/typography"
import { cn } from "@/lib/utils"

type CompositeScoreValue = Application["compositeScore"]

function formatScoreValue(value: number | null | undefined): string {
  if (typeof value !== "number") return "—"
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatWeightValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "")
}

export function CompositeScoreBadge({
  compositeScore,
  t,
  className,
}: {
  compositeScore: CompositeScoreValue
  t: TFunction
  className?: string
}) {
  if (!compositeScore) return null
  return (
    <Badge variant="outline" className={cn(className)} data-testid="composite-score-badge">
      {t("applications.composite.badge", { score: formatScoreValue(compositeScore.overall) })}
    </Badge>
  )
}

export function CompositeScoreDetail({
  compositeScore,
  t,
  defaultBreakdownOpen = false,
}: {
  compositeScore: CompositeScoreValue
  t: TFunction
  defaultBreakdownOpen?: boolean
}) {
  if (!compositeScore) return null

  const selection = compositeScore.breakdown.selection
  const assessment = compositeScore.breakdown.assessment
  const weights = Object.entries(compositeScore.weights)
    .map(([key, value]) => `${t(`applications.composite.weightKeys.${key}`)}: ${formatWeightValue(value)}`)
    .join(" · ")

  return (
    <div className="grid gap-3 rounded-md border p-3" data-testid="composite-score-detail">
      <div className="grid gap-1">
        <Typography variant="bodySm" tone="muted">{t("applications.composite.title")}</Typography>
        <Typography variant="h2" data-testid="composite-score-overall">
          {formatScoreValue(compositeScore.overall)}
        </Typography>
      </div>

      <Accordion
        type="single"
        collapsible
        defaultValue={defaultBreakdownOpen ? "breakdown" : undefined}
      >
        <AccordionItem value="breakdown">
          <AccordionTrigger data-testid="composite-score-breakdown-trigger">
            {t("applications.composite.breakdownTitle")}
          </AccordionTrigger>
          <AccordionContent data-testid="composite-score-breakdown-content">
            <div className="grid gap-2">
              <Typography variant="bodySm">
                {`${t("applications.composite.resume")}: ${formatScoreValue(compositeScore.breakdown.resume)}`}
              </Typography>
              <Typography variant="bodySm">
                {`${t("applications.composite.selection")}: ${selection
                  ? t("applications.composite.selectionStages", {
                    stage1: formatScoreValue(selection.stage1),
                    stage2: formatScoreValue(selection.stage2),
                    stage3: formatScoreValue(selection.stage3),
                    stage4: formatScoreValue(selection.stage4),
                    total: formatScoreValue(selection.total),
                  })
                  : "—"}`}
              </Typography>
              <Typography variant="bodySm">
                {`${t("applications.composite.assessment")}: ${assessment
                  ? t("applications.composite.assessmentValues", {
                    score: formatScoreValue(assessment.score),
                    trust: formatScoreValue(assessment.trust),
                  })
                  : "—"}`}
              </Typography>
              <Typography variant="bodySm">
                {`${t("applications.composite.retention")}: ${formatScoreValue(compositeScore.breakdown.retention)}`}
              </Typography>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Typography variant="bodySm" tone="muted">
        {t("applications.composite.weights", { value: weights || "—" })}
      </Typography>
    </div>
  )
}
