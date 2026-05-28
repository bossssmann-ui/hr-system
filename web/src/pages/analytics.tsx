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

import { useAuth } from '@/lib/use-auth'

function todayMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function AnalyticsPage() {
  const { user } = useAuth()
  if (!user) {
    return (
      <div style={{ padding: '2rem' }}>
        <h1>HR Analytics</h1>
        <p>Sign in to view analytics dashboards.</p>
      </div>
    )
  }
  return <AnalyticsContent />
}

function AnalyticsContent() {
  const { api } = useAuth()
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
        <h1>HR Analytics</h1>
        <button
          type="button"
          onClick={() => recompute.mutate()}
          disabled={recompute.isPending}
        >
          {recompute.isPending ? 'Recomputing…' : 'Recompute snapshot'}
        </button>
      </header>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Today’s KPIs</h2>
        {dashboard.isLoading ? (
          <p>Loading…</p>
        ) : dashboard.isError ? (
          <p style={{ color: 'crimson' }}>Failed to load dashboard.</p>
        ) : dashboard.data ? (
          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
            <Kpi label="Headcount" value={dashboard.data.headcount} />
            <Kpi label="Hired MTD" value={dashboard.data.hiredMtd} />
            <Kpi label="Terminated MTD" value={dashboard.data.terminatedMtd} />
            <Kpi label="Open requisitions" value={dashboard.data.openRequisitions} />
            <Kpi
              label="Avg time-to-hire (days)"
              value={dashboard.data.avgTimeToHireDays ?? '—'}
            />
            <Kpi
              label="Probation pass rate (QTD)"
              value={
                dashboard.data.probationPassRateQtd != null
                  ? `${dashboard.data.probationPassRateQtd}%`
                  : '—'
              }
            />
          </div>
        ) : null}
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Payroll export</h2>
        <p>Download the active employee roster for a given month as CSV.</p>
        <label>
          Month{' '}
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
          Download CSV
        </a>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Last 30 snapshots</h2>
        {snapshots.isLoading ? (
          <p>Loading…</p>
        ) : snapshots.data && snapshots.data.items.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Date</th>
                <th>Headcount</th>
                <th>Hired MTD</th>
                <th>Terminated MTD</th>
                <th>Open reqs</th>
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
          <p>No snapshots yet. Click “Recompute snapshot” to create one.</p>
        )}
      </section>
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
