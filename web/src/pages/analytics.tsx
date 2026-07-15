/**
 * Phase 7 — HR Analytics dashboard.
 *
 * KPI cards driven by `GET /api/analytics/dashboard` plus a payroll export
 * action (`GET /api/payroll/export?format=csv`). Read-only for hr_admin /
 * owner / hiring_manager; mutating actions (recompute, payroll download)
 * are restricted server-side.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { RecruiterFunnelMetrics } from '@web-app-demo/contracts'
import { useAuth } from '@/lib/use-auth'

function todayMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function scoreLevel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

export function AnalyticsPage() {
  const { user } = useAuth()
  const { t } = useTranslation('analytics')
  if (!user) {
    return (
      <div style={{ padding: '2rem' }}>
        <h1>{t('title')}</h1>
        <p>{t('signInPrompt')}</p>
      </div>
    )
  }
  return <AnalyticsContent />
}

function AnalyticsContent() {
  const { api } = useAuth()
  const { t } = useTranslation('analytics')
  const queryClient = useQueryClient()
  const [month, setMonth] = useState(todayMonth())

  const dashboard = useQuery({
    queryKey: ['analytics', 'dashboard'],
    queryFn: () => api.getHrDashboard(),
  })

  const snapshots = useQuery({
    queryKey: ['analytics', 'snapshots'],
    queryFn: () => api.listHrSnapshots({ limit: 30 }),
  })

  const recompute = useMutation({
    mutationFn: () => api.computeHrSnapshot(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['analytics'] })
    },
  })

  return (
    <div style={{ padding: '2rem' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1>{t('title')}</h1>
        <button
          type="button"
          onClick={() => recompute.mutate()}
          disabled={recompute.isPending}
        >
          {recompute.isPending ? t('snapshots.recomputing') : t('snapshots.recompute')}
        </button>
      </header>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>{t('todayKpis')}</h2>
        {dashboard.isLoading ? (
          <p>{t('loading')}</p>
        ) : dashboard.isError ? (
          <p style={{ color: 'crimson' }}>{t('loadFailed')}</p>
        ) : dashboard.data ? (
          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
            <Kpi label={t('kpi.headcount')} value={dashboard.data.headcount} />
            <Kpi label={t('kpi.hiresMtd')} value={dashboard.data.hiredMtd} />
            <Kpi label={t('kpi.terminatedMtd')} value={dashboard.data.terminatedMtd} />
            <Kpi label={t('kpi.openRequisitions')} value={dashboard.data.openRequisitions} />
            <Kpi
              label={t('kpi.avgTimeToHire')}
              value={dashboard.data.avgTimeToHireDays ?? '—'}
            />
            <Kpi
              label={t('kpi.probationPassRate')}
              value={
                dashboard.data.probationPassRateQtd != null
                  ? `${dashboard.data.probationPassRateQtd}%`
                  : '—'
              }
            />
            <Kpi
              label={t('kpi.enps')}
              value={dashboard.data.enpsScore != null ? String(dashboard.data.enpsScore) : '—'}
            />
          </div>
        ) : null}
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>{t('rosterTitle')}</h2>
        <p>{t('rosterDescription')}</p>
        <label>
          {t('month')}{' '}
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>{' '}
        <a
          href={api.payrollExportCsvUrl({ month })}
          target="_blank"
          rel="noreferrer"
        >
          {t('downloadCsv')}
        </a>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>{t('snapshots.title')}</h2>
        {snapshots.isLoading ? (
          <p>{t('loading')}</p>
        ) : snapshots.data && snapshots.data.items.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>{t('table.date')}</th>
                <th>{t('table.headcount')}</th>
                <th>{t('table.hiresMtd')}</th>
                <th>{t('table.terminatedMtd')}</th>
                <th>{t('table.openReqs')}</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.data.items.map((s) => (
                <tr key={s.id}>
                  <td>{s.snapshotDate}</td>
                  <td>{s.headcount}</td>
                  <td>{s.hiredMtd}</td>
                  <td>{s.terminatedMtd}</td>
                  <td>{s.openRequisitions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>{t('snapshots.empty')}</p>
        )}
      </section>

      <SignalsSection />

      <RecruiterFunnelSection />
    </div>
  )
}

function SignalsSection() {
  const { api } = useAuth()
  const { t } = useTranslation('analytics')
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<'open' | 'reviewed'>('open')
  const signals = useQuery({
    queryKey: ['analytics', 'signals', statusFilter],
    queryFn: () => api.listSignals({ status: statusFilter, limit: 50 }),
  })
  const update = useMutation({
    mutationFn: (id: string) => api.reviewSignal(id, { status: 'reviewed' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['analytics'] })
    },
  })
  const recompute = useMutation({
    mutationFn: () => api.computeAnalyticsSignals(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['analytics'] })
    },
  })
  const sortedSignals = useMemo(
    () => [...(signals.data?.items ?? [])].sort((a, b) => b.score - a.score),
    [signals.data?.items],
  )

  return (
    <section style={{ marginTop: '2rem' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2>{t('signals.flightRiskTitle')}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button type="button" onClick={() => recompute.mutate()} disabled={recompute.isPending}>
            {recompute.isPending ? t('signals.recomputing') : t('signals.recompute')}
          </button>
          <label className="flex items-center gap-2">
            <span>{t('signals.filterStatus')}</span>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as 'open' | 'reviewed')
              }
            >
              <option value="open">{t('signals.status.open')}</option>
              <option value="reviewed">{t('signals.status.reviewed')}</option>
            </select>
          </label>
        </div>
      </header>
      {signals.isLoading ? (
        <p>{t('loading')}</p>
      ) : signals.isError ? (
        <p style={{ color: 'crimson' }}>{t('signals.loadFailed')}</p>
      ) : sortedSignals.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>{t('table.employee')}</th>
              <th>{t('table.type')}</th>
              <th>{t('table.score')}</th>
              <th style={{ textAlign: 'left' }}>{t('table.factors')}</th>
              <th>{t('table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {sortedSignals.map((s) => (
              <tr key={s.id} data-testid={`signal-row-${s.id}`} style={{ borderTop: '1px solid #eee' }}>
                <td><code>{s.employeeId.slice(0, 8)}…</code></td>
                <td>{s.type}</td>
                <td>
                  <strong>{s.score}</strong>{' '}
                  <small>{t(`signals.level.${scoreLevel(s.score)}`)}</small>
                </td>
                <td>
                  {s.factors.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                      {s.factors.map((f, i) => (
                        <li key={i}><small>{f.note}</small></li>
                      ))}
                    </ul>
                  ) : (
                    <small>{t('signals.noFactors')}</small>
                  )}
                </td>
                <td>
                  {s.status === 'open' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => update.mutate(s.id)}
                        disabled={update.isPending}
                      >
                        {t('signals.markReviewed')}
                      </button>{' '}
                      <button
                        type="button"
                        onClick={() => {
                          void api.reviewSignal(s.id, { status: 'dismissed' }).then(() => {
                            void queryClient.invalidateQueries({ queryKey: ['analytics'] })
                          })
                        }}
                      >
                        {t('signals.dismiss')}
                      </button>
                    </>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>{t('signals.empty')}</p>
      )}
    </section>
  )
}

function RecruiterFunnelSection() {
  const { api } = useAuth()
  const { t } = useTranslation('analytics')
  const [period, setPeriod] = useState<'today' | 'week' | 'all'>('today')

  const funnel = useQuery({
    queryKey: ['analytics', 'recruiter-funnel', period],
    queryFn: () => api.getRecruiterFunnel(period),
  })

  return (
    <section className="grid gap-3">
      <header className="flex items-center justify-between gap-3">
        <h2>{t('funnel.title')}</h2>
        <label className="flex items-center gap-2">
          <span>{t('funnel.period')}</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as 'today' | 'week' | 'all')}
          >
            <option value="today">{t('funnel.periodToday')}</option>
            <option value="week">{t('funnel.periodWeek')}</option>
            <option value="all">{t('funnel.periodAll')}</option>
          </select>
        </label>
      </header>

      {funnel.isLoading ? (
        <p>{t('loading')}</p>
      ) : funnel.isError ? (
        <p style={{ color: 'crimson' }}>{t('loadFailed')}</p>
      ) : funnel.data ? (
        <RecruiterFunnelDisplay data={funnel.data} />
      ) : null}
    </section>
  )
}

export function RecruiterFunnelDisplay({ data }: { data: RecruiterFunnelMetrics }) {
  const { t } = useTranslation('analytics')

  const total = data.newApplications
  const pctAiProcessed = total > 0 ? Math.round((data.aiProcessed / total) * 100) : 0
  const pctPassed =
    data.aiProcessed > 0 ? Math.round((data.passedToRecruiter / data.aiProcessed) * 100) : 0

  if (total === 0) {
    return <p>{t('funnel.empty')}</p>
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <Kpi label={t('funnel.newApplications')} value={data.newApplications} />
        <Kpi label={t('funnel.aiProcessed')} value={data.aiProcessed} />
        <Kpi label={t('funnel.passedToRecruiter')} value={data.passedToRecruiter} />
        <Kpi label={t('funnel.aiRejected')} value={data.aiRejected} />
        <Kpi label={t('funnel.manualReview')} value={data.manualReview} />
        <Kpi label={t('funnel.inProgress')} value={data.inProgress} />
        <Kpi label={t('funnel.conversionAiProcessed')} value={`${pctAiProcessed}%`} />
        <Kpi label={t('funnel.conversionPassed')} value={`${pctPassed}%`} />
      </div>

      {data.processedCandidates.length > 0 && (
        <div className="grid gap-2">
          <h3>{t('funnel.tableTitle')}</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>{t('funnel.colCandidate')}</th>
                <th>{t('funnel.colScore')}</th>
                <th>{t('funnel.colVerdict')}</th>
                <th>{t('funnel.colTrust')}</th>
                <th>{t('funnel.colDate')}</th>
              </tr>
            </thead>
            <tbody>
              {data.processedCandidates.map((c) => (
                <tr key={c.applicationId} style={{ borderTop: '1px solid #eee' }}>
                  <td aria-label={`Candidate ${c.candidateId}`}><code>{c.candidateId.slice(0, 8)}…</code></td>
                  <td>
                    {c.unifiedScore != null ? (
                      <>
                        <strong>{c.unifiedScore}</strong>{' '}
                        <small>({t(`funnel.score${c.scoreStatus === 'final' ? 'Final' : 'Preliminary'}`)})</small>
                      </>
                    ) : '—'}
                  </td>
                  <td>{c.verdict ?? '—'}</td>
                  <td>{c.trustScore != null ? c.trustScore : '—'}</td>
                  {/* createdAt is always ISO 8601; slice(0,10) extracts YYYY-MM-DD */}
                  <td><small>{c.createdAt.slice(0, 10)}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.bySource && Object.keys(data.bySource).length > 0 && (
        <div className="grid gap-2">
          <h3>{t('funnel.bySource.title')}</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>{t('funnel.bySource.colSource')}</th>
                <th>{t('funnel.bySource.colApplications')}</th>
                <th>{t('funnel.bySource.colConversion')}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.bySource).map(([src, stats]) => {
                const pct = stats.aiProcessed > 0 ? Math.round((stats.passedToRecruiter / stats.aiProcessed) * 100) : 0
                const label = src === 'hh' || src === 'direct'
                  ? t(`funnel.bySource.${src}`)
                  : src
                return (
                  <tr key={src} style={{ borderTop: '1px solid #eee' }}>
                    <td>{label}</td>
                    <td>{stats.applications}</td>
                    <td>{stats.aiProcessed > 0 ? `${pct}%` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ border: '1px solid #ddd', padding: '0.75rem 1rem', borderRadius: 4 }}>
      <div style={{ fontSize: '0.85rem', color: '#666' }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{value}</div>
    </div>
  )
}
