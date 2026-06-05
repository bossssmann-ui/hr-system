/**
 * Phase 7 — HR Analytics dashboard.
 *
 * KPI cards driven by `GET /api/analytics/dashboard` plus a payroll export
 * action (`GET /api/payroll/export?format=csv`). Read-only for hr_admin /
 * owner / hiring_manager; mutating actions (recompute, payroll download)
 * are restricted server-side.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/lib/use-auth'

function todayMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function AnalyticsPage() {
  const { user } = useAuth()
  const { t } = useTranslation('analytics')
  if (!user) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-3 px-5 py-12">
        <h1>{t('title')}</h1>
        <p>{t('signInPrompt')}</p>
      </section>
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
    <section className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-12">
      <header className="flex items-center justify-between gap-3">
        <h1>{t('title')}</h1>
        <button
          type="button"
          onClick={() => recompute.mutate()}
          disabled={recompute.isPending}
        >
          {recompute.isPending ? t('snapshots.recomputing') : t('snapshots.recompute')}
        </button>
      </header>

      <section className="grid gap-3">
        <h2>{t('todayKpis')}</h2>
        {dashboard.isLoading ? (
          <p>{t('loading')}</p>
        ) : dashboard.isError ? (
          <p style={{ color: 'crimson' }}>{t('loadFailed')}</p>
        ) : dashboard.data ? (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
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
          </div>
        ) : null}
      </section>

      <section className="grid gap-3">
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

      <section className="grid gap-3">
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
    </section>
  )
}

function SignalsSection() {
  const { api } = useAuth()
  const { t } = useTranslation('analytics')
  const queryClient = useQueryClient()
  const signals = useQuery({
    queryKey: ['analytics', 'signals'],
    queryFn: () => api.listAnalyticsSignals({ status: 'open', limit: 50 }),
  })
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'reviewed' | 'dismissed' }) =>
      api.updateAnalyticsSignal(id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['analytics', 'signals'] })
    },
  })
  const recompute = useMutation({
    mutationFn: () => api.computeAnalyticsSignals(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['analytics', 'signals'] })
    },
  })

  return (
    <section className="grid gap-3">
      <header className="flex items-center justify-between gap-3">
        <h2>{t('signals.title')}</h2>
        <button type="button" onClick={() => recompute.mutate()} disabled={recompute.isPending}>
          {recompute.isPending ? t('signals.recomputing') : t('signals.recompute')}
        </button>
      </header>
      {signals.isLoading ? (
        <p>{t('loading')}</p>
      ) : signals.data && signals.data.items.length > 0 ? (
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
            {signals.data.items.map((s) => (
              <tr key={s.id} style={{ borderTop: '1px solid #eee' }}>
                <td><code>{s.employeeId.slice(0, 8)}…</code></td>
                <td>{s.type}</td>
                <td><strong>{s.score}</strong></td>
                <td>
                  <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                    {s.factors.map((f, i) => (
                      <li key={i}><small>{f.note}</small></li>
                    ))}
                  </ul>
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => update.mutate({ id: s.id, status: 'reviewed' })}
                    disabled={update.isPending}
                  >
                    {t('signals.reviewed')}
                  </button>{' '}
                  <button
                    type="button"
                    onClick={() => update.mutate({ id: s.id, status: 'dismissed' })}
                    disabled={update.isPending}
                  >
                    {t('signals.dismiss')}
                  </button>
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

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border px-4 py-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  )
}
