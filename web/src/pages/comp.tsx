/**
 * Phase 3 — Compensation calculator + band catalogue.
 *
 * Recruiter-facing page: pick a grade + currency, type a salary, see the
 * percentile bar against the band, and edit the catalogue (admin only).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { CompBand, CompCalculatorResponse } from '@web-app-demo/contracts'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { ApiRequestError } from '@/lib/api'
import { isAdmin } from '@/lib/roles'
import { useAuth } from '@/lib/use-auth'
import { cn } from '@/lib/utils'

const CURRENCIES = ['RUB', 'USD', 'THB', 'USDT'] as const
type Currency = (typeof CURRENCIES)[number]

export function CompPage() {
  const { user } = useAuth()
  const { t } = useTranslation(['comp', 'common'])
  if (!user) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-4 px-5 py-16">
        <Badge variant="outline" className="w-fit">{t('common:states.loginRequired')}</Badge>
        <Typography variant="h2">{t('common:states.loginRequired')}</Typography>
        <Link to="/" className={cn(buttonVariants({ size: 'lg' }), 'w-fit')}>{t('common:actions.goToAuth')}</Link>
      </section>
    )
  }
  return <CompContent />
}

function CompContent() {
  const { api, user } = useAuth()
  const { t } = useTranslation('comp')
  const queryClient = useQueryClient()
  const admin = isAdmin(user)

  const bandsQuery = useQuery({
    queryKey: ['comp', 'bands'],
    queryFn: () => api.listCompBands(),
  })

  const [grade, setGrade] = useState('')
  const [currency, setCurrency] = useState<Currency>('RUB')
  const [salary, setSalary] = useState('')
  const [calcResult, setCalcResult] = useState<CompCalculatorResponse | null>(null)
  const [calcError, setCalcError] = useState<string | null>(null)

  const calcMutation = useMutation({
    mutationFn: () =>
      api.compCalculator({ grade, salary: Number(salary), currency }),
    onSuccess: (data) => {
      setCalcResult(data)
      setCalcError(null)
    },
    onError: (err) => {
      setCalcResult(null)
      setCalcError(err instanceof ApiRequestError ? err.message : t('calculator.failed'))
    },
  })

  const createMutation = useMutation({
    mutationFn: (input: {
      grade: string
      currency: Currency
      minSalary: number
      midSalary: number
      maxSalary: number
    }) => api.createCompBand(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comp', 'bands'] })
      toast.success(t('bands.created'))
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('bands.createFailed')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteCompBand(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comp', 'bands'] })
      toast.success(t('bands.deleted'))
    },
  })

  const bands = bandsQuery.data?.items ?? []

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-12">
      <div className="grid gap-2">
        <Badge variant="outline" className="w-fit">{t('badge')}</Badge>
        <Typography variant="h1">{t('title')}</Typography>
        <Typography tone="muted">{t('subtitle')}</Typography>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('calculator.title')}</CardTitle>
          <CardDescription>{t('calculator.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label className="text-sm font-medium">{t('calculator.grade')}</label>
              <Input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder={t('calculator.gradePlaceholder')} />
            </div>
            <div>
              <label className="text-sm font-medium">{t('calculator.currency')}</label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">{t('calculator.salary')}</label>
              <Input
                type="number"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                placeholder={t('calculator.salaryPlaceholder')}
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => calcMutation.mutate()}
                disabled={!grade || !salary || calcMutation.isPending}
              >
                {calcMutation.isPending ? <Spinner /> : t('calculator.calculate')}
              </Button>
            </div>
          </div>

          {calcError && (
            <Alert variant="destructive">
              <AlertTitle>{t('errorTitle')}</AlertTitle>
              <AlertDescription>{calcError}</AlertDescription>
            </Alert>
          )}

          {calcResult?.band && (
            <CalculatorResult result={calcResult} salary={Number(salary)} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('bands.title')}</CardTitle>
              <CardDescription>{t('bands.description')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {bandsQuery.isPending && <Spinner />}
          {bandsQuery.isError && (
            <Alert variant="destructive">
              <AlertTitle>{t('bands.loadFailedTitle')}</AlertTitle>
              <AlertDescription>
                {bandsQuery.error instanceof ApiRequestError
                  ? bandsQuery.error.message
                  : t('bands.unknownError')}
              </AlertDescription>
            </Alert>
          )}
          {bands.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2">{t('bands.fields.grade')}</th>
                  <th>{t('bands.fields.currency')}</th>
                  <th>{t('bands.fields.min')}</th>
                  <th>{t('bands.fields.mid')}</th>
                  <th>{t('bands.fields.max')}</th>
                  {admin && <th></th>}
                </tr>
              </thead>
              <tbody>
                {bands.map((b: CompBand) => (
                  <tr key={b.id} className="border-b">
                    <td className="py-2">{b.grade}</td>
                    <td>{b.currency}</td>
                    <td>{b.minSalary.toLocaleString()}</td>
                    <td>{b.midSalary.toLocaleString()}</td>
                    <td>{b.maxSalary.toLocaleString()}</td>
                    {admin && (
                      <td>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteMutation.mutate(b.id)}
                        >
                          {t('bands.delete')}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {admin && (
            <CreateBandForm
              onCreate={(input) => createMutation.mutate(input)}
              isPending={createMutation.isPending}
            />
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function CalculatorResult({
  result,
  salary,
}: {
  result: CompCalculatorResponse
  salary: number
}) {
  const { t } = useTranslation('comp')
  const { band, zone, percentile } = result
  if (!band) return null
  const zoneColor =
    zone === 'within' ? 'bg-green-500' : zone === 'above' ? 'bg-orange-500' : 'bg-red-500'
  const min = band.minSalary
  const max = band.maxSalary
  const range = Math.max(1, max - min)
  const clampedSalary = Math.max(min, Math.min(max, salary))
  const markerPct = Math.round(((clampedSalary - min) / range) * 100)

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <Badge variant="outline">{band.grade} · {band.currency}</Badge>
        <Badge className={cn('text-white', zoneColor)}>{t(`result.zone.${zone}`)}</Badge>
        <Typography>{t('result.percentile')} <strong>{percentile}</strong></Typography>
      </div>
      <div className="relative h-3 rounded-full bg-muted">
        <div
          className="absolute top-0 h-3 w-2 -translate-x-1/2 rounded-sm bg-foreground"
          style={{ left: `${markerPct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{t('result.min')} {min.toLocaleString()}</span>
        <span>{t('result.mid')} {band.midSalary.toLocaleString()}</span>
        <span>{t('result.max')} {max.toLocaleString()}</span>
      </div>
    </div>
  )
}

function CreateBandForm({
  onCreate,
  isPending,
}: {
  onCreate: (input: { grade: string; currency: Currency; minSalary: number; midSalary: number; maxSalary: number }) => void
  isPending: boolean
}) {
  const { t } = useTranslation('comp')
  const [grade, setGrade] = useState('')
  const [currency, setCurrency] = useState<Currency>('RUB')
  const [min, setMin] = useState('')
  const [mid, setMid] = useState('')
  const [max, setMax] = useState('')

  const canSubmit = useMemo(() => {
    const mn = Number(min); const md = Number(mid); const mx = Number(max)
    return grade.length > 0 && mn > 0 && md > 0 && mx > 0 && mn <= md && md <= mx
  }, [grade, min, mid, max])

  return (
    <div className="grid grid-cols-1 gap-2 rounded border p-4 md:grid-cols-6">
      <Input placeholder={t('bands.addPlaceholder.grade')} value={grade} onChange={(e) => setGrade(e.target.value)} />
      <select
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
        value={currency}
        onChange={(e) => setCurrency(e.target.value as Currency)}
      >
        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <Input placeholder={t('bands.addPlaceholder.min')} type="number" value={min} onChange={(e) => setMin(e.target.value)} />
      <Input placeholder={t('bands.addPlaceholder.mid')} type="number" value={mid} onChange={(e) => setMid(e.target.value)} />
      <Input placeholder={t('bands.addPlaceholder.max')} type="number" value={max} onChange={(e) => setMax(e.target.value)} />
      <Button
        disabled={!canSubmit || isPending}
        onClick={() => {
          onCreate({
            grade,
            currency,
            minSalary: Number(min),
            midSalary: Number(mid),
            maxSalary: Number(max),
          })
          setGrade(''); setMin(''); setMid(''); setMax('')
        }}
      >
        {t('bands.add')}
      </Button>
    </div>
  )
}
