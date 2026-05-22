/**
 * Phase 1G — Public careers pages.
 *
 * These pages are unauthenticated — they must not import the authenticated
 * app shell and must be reachable while logged out.
 *
 * Routes:
 *   /careers            — list of open vacancies
 *   /careers/:slug      — vacancy detail + apply form
 */

import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import type { PublicApplyRequest, PublicVacancy } from '@web-app-demo/contracts'
import { publicApplyRequestSchema } from '@web-app-demo/contracts'
import { useState } from 'react'
import { z } from 'zod'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { Typography } from '@/components/ui/typography'
import { cn } from '@/lib/utils'

const apiBaseUrl = (import.meta.env?.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')

// ─── Public API helpers ───────────────────────────────────────────────────────

async function fetchPublicVacancies(): Promise<PublicVacancy[]> {
  const res = await fetch(`${apiBaseUrl}/api/public/vacancies`)
  if (!res.ok) throw new Error('Failed to load vacancies')
  const data = await res.json()
  return data.items as PublicVacancy[]
}

async function fetchPublicVacancy(slug: string): Promise<PublicVacancy> {
  const res = await fetch(`${apiBaseUrl}/api/public/vacancies/${encodeURIComponent(slug)}`)
  if (res.status === 404) throw new Error('Vacancy not found')
  if (!res.ok) throw new Error('Failed to load vacancy')
  return res.json() as Promise<PublicVacancy>
}

async function submitApplication(
  slug: string,
  payload: PublicApplyRequest,
): Promise<{ reference: string; message: string }> {
  const res = await fetch(`${apiBaseUrl}/api/public/vacancies/${encodeURIComponent(slug)}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  if (!res.ok) {
    const code: string = data?.error?.code ?? 'UNKNOWN'
    const msg: string = data?.error?.message ?? 'Submission failed'
    throw new CareersApiError(res.status, code, msg)
  }
  return data as { reference: string; message: string }
}

class CareersApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// ─── OG / meta tag helper ─────────────────────────────────────────────────────

function PageMeta({ title, description }: { title: string; description?: string }) {
  // Client-side meta injection (acceptable for Phase 1G; Astro SSR is a
  // TODO(phase-1g+) for full organic-SEO).
  if (typeof document !== 'undefined') {
    document.title = title
    const setMeta = (property: string, content: string, useProperty = false) => {
      const attr = useProperty ? 'property' : 'name'
      let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${property}"]`)
      if (!el) {
        el = document.createElement('meta')
        el.setAttribute(attr, property)
        document.head.appendChild(el)
      }
      el.setAttribute('content', content)
    }
    if (description) setMeta('description', description)
    setMeta('og:title', title, true)
    if (description) setMeta('og:description', description, true)
    setMeta('og:type', 'website', true)
  }
  return null
}

// ─── Careers List Page ────────────────────────────────────────────────────────

export function CareersPage() {
  const { data: vacancies, isLoading, error } = useQuery({
    queryKey: ['public-vacancies'],
    queryFn: fetchPublicVacancies,
  })

  return (
    <div className="min-h-svh bg-background text-foreground">
      <PageMeta
        title="Open Vacancies — Careers"
        description="Browse our open positions and apply today."
      />

      <header className="border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-4xl items-center px-5">
          <Typography variant="h6">Careers</Typography>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-5 py-12">
        <section className="mb-10">
          <Typography variant="h2" className="mb-2">Open Positions</Typography>
          <Typography tone="muted">
            We're growing! Browse our current openings and find your next role.
          </Typography>
        </section>

        {isLoading && (
          <div className="flex items-center gap-3">
            <Spinner aria-hidden />
            <Typography tone="muted">Loading vacancies…</Typography>
          </div>
        )}

        {error && (
          <Alert variant="destructive" className="max-w-lg">
            <AlertTitle>Failed to load vacancies</AlertTitle>
            <AlertDescription>Please try refreshing the page.</AlertDescription>
          </Alert>
        )}

        {!isLoading && !error && vacancies?.length === 0 && (
          <Typography tone="muted">No open positions right now. Check back soon!</Typography>
        )}

        {vacancies && vacancies.length > 0 && (
          <div className="grid gap-4">
            {vacancies.map((v) => (
              <Link key={v.slug} to="/careers/$slug" params={{ slug: v.slug }}>
                <Card className="transition-shadow hover:shadow-md cursor-pointer">
                  <CardHeader>
                    <CardTitle>{v.title}</CardTitle>
                    <CardDescription className="line-clamp-2">{v.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Badge variant="outline">Apply →</Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

// ─── Vacancy Detail + Apply Form ──────────────────────────────────────────────

const applyFormSchema = z.object({
  full_name: z.string().min(1, 'Name is required'),
  email: z.string().email('Enter a valid email'),
  phone: z.string().optional(),
  cover_note: z.string().optional(),
  resume_link: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  consent: z.boolean().refine((v) => v, { message: 'Consent is required' }),
})

type ApplyFormValues = z.infer<typeof applyFormSchema>

export function CareersVacancyPage() {
  const { slug } = useParams({ from: '/careers/$slug' })

  const {
    data: vacancy,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['public-vacancy', slug],
    queryFn: () => fetchPublicVacancy(slug),
  })

  const [submitted, setSubmitted] = useState(false)
  const [submittedRef, setSubmittedRef] = useState('')
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof ApplyFormValues, string>>>({})
  const [form, setForm] = useState<ApplyFormValues>({
    full_name: '',
    email: '',
    phone: '',
    cover_note: '',
    resume_link: '',
    consent: false,
  })

  const mutation = useMutation({
    mutationFn: (payload: PublicApplyRequest) => submitApplication(slug, payload),
    onSuccess: (data) => {
      setSubmitted(true)
      setSubmittedRef(data.reference)
    },
  })

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
    if (formErrors[name as keyof ApplyFormValues]) {
      setFormErrors((prev) => ({ ...prev, [name]: undefined }))
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const parsed = applyFormSchema.safeParse(form)
    if (!parsed.success) {
      const errors: Partial<Record<keyof ApplyFormValues, string>> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ApplyFormValues
        errors[key] = issue.message
      }
      setFormErrors(errors)
      return
    }

    const payload = publicApplyRequestSchema.parse({
      full_name: form.full_name,
      email: form.email,
      ...(form.phone ? { phone: form.phone } : {}),
      ...(form.cover_note ? { cover_note: form.cover_note } : {}),
      ...(form.resume_link ? { resume_link: form.resume_link } : {}),
      consent: form.consent,
      // Honeypot field — intentionally left empty by real users.
      website: '',
    })

    mutation.mutate(payload)
  }

  if (isLoading) {
    return (
      <div className="min-h-svh flex items-center justify-center">
        <Spinner aria-hidden />
      </div>
    )
  }

  if (error || !vacancy) {
    return (
      <div className="min-h-svh bg-background text-foreground">
        <header className="border-b bg-background/95 backdrop-blur">
          <div className="mx-auto flex min-h-16 w-full max-w-4xl items-center gap-4 px-5">
            <Link to="/careers" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
              ← Back to Careers
            </Link>
          </div>
        </header>
        <main className="mx-auto w-full max-w-4xl px-5 py-12">
          <Alert variant="destructive" className="max-w-lg">
            <AlertTitle>Vacancy not found</AlertTitle>
            <AlertDescription>
              This position may have been filled or the link is incorrect.
            </AlertDescription>
          </Alert>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <PageMeta
        title={`${vacancy.title} — Careers`}
        description={vacancy.description.slice(0, 160)}
      />

      <header className="border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-4xl items-center gap-4 px-5">
          <Link to="/careers" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
            ← Back to Careers
          </Link>
          <Typography variant="h6" className="ml-auto">
            Careers
          </Typography>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-5 py-12">
        {/* Vacancy header */}
        <section className="mb-10">
          <Badge variant="outline" className="mb-3">Open Position</Badge>
          <Typography variant="h2" className="mb-4">
            {vacancy.title}
          </Typography>
          <Typography tone="muted" className="whitespace-pre-wrap">
            {vacancy.description}
          </Typography>
        </section>

        {/* Apply form / thank-you */}
        {submitted ? (
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>🎉 Application received!</CardTitle>
              <CardDescription>
                Thank you for applying. We will review your application and reach out soon.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Typography tone="muted" className="text-sm">
                Reference: <span className="font-mono">{submittedRef}</span>
              </Typography>
            </CardContent>
          </Card>
        ) : (
          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>Apply for this position</CardTitle>
              <CardDescription>
                Fill in your details below. Fields marked * are required.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {mutation.error && (
                <Alert variant="destructive" className="mb-6">
                  <AlertTitle>Submission failed</AlertTitle>
                  <AlertDescription>
                    {mutation.error instanceof CareersApiError
                      ? mutation.error.code === 'CONSENT_REQUIRED'
                        ? 'Please check the consent box to proceed.'
                        : mutation.error.message
                      : 'Something went wrong. Please try again.'}
                  </AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleSubmit} className="grid gap-5" noValidate>
                {/* Honeypot — hidden from real users, filled by bots */}
                <input
                  type="text"
                  name="website"
                  autoComplete="off"
                  tabIndex={-1}
                  aria-hidden
                  style={{ display: 'none' }}
                  onChange={handleChange}
                />

                <div className="grid gap-2">
                  <Label htmlFor="full_name">Full name *</Label>
                  <Input
                    id="full_name"
                    name="full_name"
                    value={form.full_name}
                    onChange={handleChange}
                    autoComplete="name"
                    aria-invalid={!!formErrors.full_name}
                  />
                  {formErrors.full_name && (
                    <p className="text-destructive text-sm">{formErrors.full_name}</p>
                  )}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={handleChange}
                    autoComplete="email"
                    aria-invalid={!!formErrors.email}
                  />
                  {formErrors.email && (
                    <p className="text-destructive text-sm">{formErrors.email}</p>
                  )}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    value={form.phone}
                    onChange={handleChange}
                    autoComplete="tel"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="resume_link">Resume link (URL)</Label>
                  <Input
                    id="resume_link"
                    name="resume_link"
                    type="url"
                    value={form.resume_link}
                    onChange={handleChange}
                    placeholder="https://…"
                    aria-invalid={!!formErrors.resume_link}
                  />
                  {formErrors.resume_link && (
                    <p className="text-destructive text-sm">{formErrors.resume_link}</p>
                  )}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="cover_note">Cover note</Label>
                  <Textarea
                    id="cover_note"
                    name="cover_note"
                    value={form.cover_note}
                    onChange={handleChange}
                    rows={4}
                    placeholder="Tell us why you're interested…"
                  />
                </div>

                {/* 152-ФЗ consent checkbox */}
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="consent"
                    checked={form.consent}
                    onCheckedChange={(checked) =>
                      setForm((prev) => ({ ...prev, consent: checked === true }))
                    }
                    aria-invalid={!!formErrors.consent}
                  />
                  <div className="grid gap-1">
                    <Label
                      htmlFor="consent"
                      className={cn(formErrors.consent && 'text-destructive')}
                    >
                      I consent to the processing of my personal data in accordance with
                      Federal Law No. 152-ФЗ «On Personal Data». *
                    </Label>
                    {formErrors.consent && (
                      <p className="text-destructive text-sm">{formErrors.consent}</p>
                    )}
                  </div>
                </div>

                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? (
                    <>
                      <Spinner aria-hidden className="mr-2 size-4" />
                      Submitting…
                    </>
                  ) : (
                    'Submit Application'
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
