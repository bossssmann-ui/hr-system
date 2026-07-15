/**
 * Phase 1B Playwright smoke test — full recruiting journey.
 *
 * Walks through:
 *   1. Log in as the seeded bootstrap owner
 *   2. Create an org unit
 *   3. Create a hiring requisition
 *   4. Approve the requisition step-by-step through to `approved`
 *   5. Verify the auto-created vacancy appears
 *   6. Create a candidate
 *   7. Create an application linking that candidate to the vacancy
 *   8. Move the application from `new` to `screen` on the kanban
 *
 * Prerequisites: the database must be seeded with a bootstrap owner before
 * this test runs (global-setup.ts calls `prisma:seed` which is idempotent).
 * Credentials come from the same BOOTSTRAP_* env vars used by the seed.
 */

import { expect, test, uniqueEmail } from '../helpers/test'

// Credentials for the bootstrap owner seeded by prisma:seed.
// Defaults match the CI job env; override locally via BOOTSTRAP_* env vars.
const ownerEmail = process.env.BOOTSTRAP_OWNER_EMAIL ?? 'e2e-owner@example.com'
const ownerPassword = process.env.BOOTSTRAP_OWNER_PASSWORD ?? 'E2eOwnerPass1!'

test.describe('Phase 1B recruiting smoke', () => {
  let accessToken: string

  test.beforeAll(async ({ request }) => {
    // Log in as the seeded owner (already has `owner` role + tenant).
    const loginRes = await request.post('/api/auth/login', {
      data: {
        email: ownerEmail,
        password: ownerPassword,
      },
    })
    expect(loginRes.ok(), `owner login failed — is the DB seeded? status=${loginRes.status()}`).toBeTruthy()
    const loginBody = await loginRes.json()
    accessToken = loginBody.accessToken as string
  })

  test('complete recruiting journey', async ({ page, request }) => {
    // Helper: make an authenticated API call.
    const api = async (method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) => {
      const res = await request[method === 'GET' ? 'get' : method === 'POST' ? 'post' : 'patch'](
        path,
        {
          data: body,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      )
      return res
    }

    // ── Step 1: Log in via UI ───────────────────────────────────────────────
    await page.goto('/')
    await page.getByRole('tab', { name: 'Login' }).click()
    await page.getByLabel('Email').fill(ownerEmail)
    await page.getByLabel('Password').fill(ownerPassword)
    await page.getByRole('button', { name: 'Login' }).click()
    await expect(page.getByRole('heading', { name: 'Session is active' })).toBeVisible()

    // ── Step 2: Create an org unit via API ─────────────────────────────────
    const orgUnitRes = await api('POST', '/api/org-units', { name: 'Engineering E2E' })
    expect(orgUnitRes.ok()).toBeTruthy()
    const orgUnitId = (await orgUnitRes.json()).id as string

    // ── Step 3: Create a requisition via the UI ────────────────────────────
    await page.goto('/requisitions/new')
    await expect(page.getByTestId('requisition-form')).toBeVisible()

    await page.getByTestId('org-unit-select').selectOption({ value: orgUnitId })
    await page.getByTestId('title-input').fill('Senior Engineer E2E')
    // Fill grade field — accessible by label since test id isn't set
    await page.getByLabel('Grade').fill('M3')
    await page.getByTestId('salary-min-input').fill('200000')
    await page.getByTestId('salary-max-input').fill('350000')
    await page.getByTestId('justification-input').fill('E2E smoke test requisition')
    await page.getByTestId('submit-button').click()

    // Should redirect to detail page.
    await expect(page.getByRole('heading', { name: 'Senior Engineer E2E' })).toBeVisible()
    await expect(page.getByText('Draft')).toBeVisible()

    // ── Step 4: Approve through FSM to `approved` ─────────────────────────
    await page.getByTestId('transition-submitted').click()
    await expect(page.getByText('Submitted')).toBeVisible()

    await page.getByTestId('transition-manager_approved').click()
    await expect(page.getByText('Manager Approved')).toBeVisible()

    await page.getByTestId('transition-hr_approved').click()
    await expect(page.getByText('HR Approved')).toBeVisible()

    await page.getByTestId('transition-approved').click()
    await expect(page.getByText('Approved')).toBeVisible()

    // ── Step 5: Verify auto-created vacancy ────────────────────────────────
    await page.goto('/vacancies')
    await expect(page.getByText('Senior Engineer E2E').first()).toBeVisible()

    // Get the vacancy ID via API.
    const vacanciesRes = await api('GET', '/api/vacancies')
    expect(vacanciesRes.ok()).toBeTruthy()
    const vacancies = (await vacanciesRes.json()).items as Array<{ id: string; title: string }>
    const vacancy = vacancies.find((v) => v.title === 'Senior Engineer E2E')
    expect(vacancy).toBeDefined()
    const vacancyId = vacancy!.id

    // ── Step 6: Create a candidate via UI ─────────────────────────────────
    await page.goto('/candidates')
    await page.getByTestId('new-candidate-button').click()
    const candidateEmail = uniqueEmail('cand-smoke')
    await page.getByTestId('candidate-fullname').fill('Alice Smoketest')
    await page.getByTestId('candidate-email').fill(candidateEmail)
    await page.getByTestId('create-candidate-submit').click()
    await expect(page.getByText('Alice Smoketest')).toBeVisible()

    // Get the candidate ID via API.
    const candidatesRes = await api('GET', '/api/candidates')
    expect(candidatesRes.ok()).toBeTruthy()
    const candidates = (await candidatesRes.json()).items as Array<{
      id: string
      fullName: string
    }>
    const candidate = candidates.find((c) => c.fullName === 'Alice Smoketest')
    expect(candidate).toBeDefined()
    const candidateId = candidate!.id

    // ── Step 7: Create an application via the kanban UI ───────────────────
    await page.goto('/applications')
    await page.getByTestId('new-application-button').click()

    await page.getByTestId('app-vacancy-select').selectOption({ label: 'Senior Engineer E2E' })
    await page.getByTestId('applications.create.candidate-checkbox').first().check()
    await page.getByTestId('applications.create.submit').click()
    await expect(page.getByText(/Created 1, skipped 0/i)).toBeVisible()

    // Verify the card appears in the `new` column.
    await expect(page.getByTestId('kanban-column-new')).toBeVisible()
    await expect(page.getByTestId('kanban-column-new')).toContainText('Alice Smoketest')

    // ── Step 8: Move application stage via API (DnD is flaky in CI) ───────
    const appsRes = await api('GET', `/api/applications?vacancy_id=${vacancyId}`)
    expect(appsRes.ok()).toBeTruthy()
    const apps = (await appsRes.json()).items as Array<{ id: string; stage: string; candidateId: string }>
    const app = apps.find((a) => a.stage === 'new' && a.candidateId === candidateId)
    expect(app).toBeDefined()

    const moveRes = await api('PATCH', `/api/applications/${app!.id}/stage`, { to: 'screen' })
    expect(moveRes.ok()).toBeTruthy()

    // Reload kanban and verify the card moved to `screen`.
    await page.reload()
    await expect(page.getByTestId('kanban-column-screen')).toBeVisible()
    // Kanban cards show the candidate full name when known.
    const screenColumn = page.getByTestId('kanban-column-screen')
    await expect(screenColumn).toContainText('Alice Smoketest')

    // ── Bonus: audit log shows events ─────────────────────────────────────
    const auditRes = await api('GET', '/api/admin/audit-events?limit=20')
    expect(auditRes.ok()).toBeTruthy()
    const auditEvents = (await auditRes.json()).items as Array<{ action: string }>
    expect(auditEvents.some((e) => e.action === 'requisition.create')).toBeTruthy()
    expect(auditEvents.some((e) => e.action === 'requisition.transition')).toBeTruthy()
    expect(auditEvents.some((e) => e.action === 'candidate.create')).toBeTruthy()
    expect(auditEvents.some((e) => e.action === 'application.create')).toBeTruthy()
    expect(auditEvents.some((e) => e.action === 'application.move_stage')).toBeTruthy()
  })
})

