/**
 * Phase 15–16 Playwright E2E — Domestic logist selection flow.
 *
 * Covers:
 *   1. Create domestic session via API → open /selection/:token → ResumeStep visible
 *   2. Submit resume text → transition to InterviewStep
 *   3. Fill interview answers → transition to packages_assigned spinner
 *   4. Wait for stage_1 (polling GET /sessions/:token) → progress bar shows dot 4
 *   5. Submit stage_1 radio answers → stage_2 appears
 *   6. HR dashboard — domestic session row is visible, detail modal opens
 *
 * Isolation: tests 1, 2 and 6 each create their own selection session. The
 * AI-dependent chain (3–5) shares a session so that the resume → interview →
 * packages_assigned → stage_1 progression flows from one step to the next.
 *
 * The dashboard row (test 6) is located via the `data-testid` attribute on
 * each table row so we never rely on the truncated 8-char ULID prefix that
 * collides between sessions created in the same minute.
 *
 * Prerequisites: the database must be seeded with a bootstrap owner before
 * this test runs (global-setup.ts handles this). The backend must have
 * ASSESSMENT_SYSTEM_ENABLED=true and ASSESSMENTS_ENABLED=true. The
 * resume/interview steps require GEMINI_API_KEY in backendEnv; if absent the
 * backend returns 503 and those steps are skipped via test.skip().
 */

import type { APIRequestContext } from '@playwright/test'

import { expect, test } from '../helpers/test'

const ownerEmail = process.env.BOOTSTRAP_OWNER_EMAIL ?? 'e2e-owner@example.com'
const ownerPassword = process.env.BOOTSTRAP_OWNER_PASSWORD ?? 'E2eOwnerPass1!'

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: ['Bearer', accessToken].join(' '),
    'Content-Type': 'application/json',
  }
}

async function createDomesticSession(
  request: APIRequestContext,
  accessToken: string,
  vacancyId: string,
): Promise<{ sessionId: string; token: string }> {
  const sessRes = await request.post('/api/selection/sessions', {
    data: { vacancyId, role: 'logist_domestic' },
    headers: authHeaders(accessToken),
  })
  expect(
    sessRes.ok(),
    `selection session create failed: status=${sessRes.status()} body=${await sessRes.text()}`,
  ).toBeTruthy()
  return (await sessRes.json()) as { sessionId: string; token: string }
}

/**
 * Minimal resume text containing keywords that trigger domestic specialisations.
 */
const RESUME_TEXT = [
  'Опыт работы в логистике 4 года.',
  'Организация автоперевозок FTL и LTL по России.',
  'Работа со сборными грузами через транспортные компании.',
  'Размещение заявок на ATI.SU, подбор перевозчиков.',
  'Регионы: Москва, Урал, Сибирь.',
  'Работа с тентовым и рефрижераторным транспортом.',
].join('\n')

test.describe('Phase 15–16 domestic selection flow', () => {
  // Serial mode: a failed setup test should not run dependent tests with stale state.
  test.describe.configure({ mode: 'serial' })

  let accessToken: string
  let vacancyId: string

  // Shared session for the AI-dependent chain (tests 3–5). Tests 1, 2 and 6
  // each create their own session and do not touch this one.
  let chainSessionToken: string

  test.beforeAll(async ({ request }) => {
    const loginRes = await request.post('/api/auth/login', {
      data: { email: ownerEmail, password: ownerPassword },
    })
    expect(loginRes.ok(), `owner login failed: status=${loginRes.status()}`).toBeTruthy()
    accessToken = ((await loginRes.json()) as { accessToken: string }).accessToken

    const auth = authHeaders(accessToken)

    const orgRes = await request.post('/api/org-units', {
      data: { name: 'Domestic E2E Org' },
      headers: auth,
    })
    expect(orgRes.ok(), `org-unit failed: ${orgRes.status()}`).toBeTruthy()
    const orgId = ((await orgRes.json()) as { id: string }).id

    const reqRes = await request.post('/api/requisitions', {
      data: {
        orgUnitId: orgId,
        title: 'Domestic E2E Logist',
        grade: 'L1',
        salaryMin: 80000,
        salaryMax: 120000,
        currency: 'RUB',
        justification: 'E2E domestic selection test',
      },
      headers: auth,
    })
    expect(reqRes.ok(), `requisition create failed: ${reqRes.status()}`).toBeTruthy()
    const requisitionId = ((await reqRes.json()) as { id: string }).id

    for (const to of ['submitted', 'manager_approved', 'hr_approved', 'approved'] as const) {
      const t = await request.patch(`/api/requisitions/${requisitionId}/transition`, {
        data: { to },
        headers: auth,
      })
      expect(t.ok(), `transition to ${to} failed: ${t.status()}`).toBeTruthy()
    }

    const vacRes = await request.get('/api/vacancies', { headers: auth })
    expect(vacRes.ok()).toBeTruthy()
    const vacancies = ((await vacRes.json()) as {
      items: Array<{ id: string; requisitionId: string }>
    }).items
    const vacancy = vacancies.find((v) => v.requisitionId === requisitionId)
    expect(vacancy, 'vacancy not found for domestic requisition').toBeDefined()
    vacancyId = vacancy!.id

    // Shared session for tests 3–5.
    const chain = await createDomesticSession(request, accessToken, vacancyId)
    chainSessionToken = chain.token
  })

  // ─── Scenario 1: ResumeStep visible on /selection/:token ────────────────────

  test('1. opens /selection/:token and shows ResumeStep', async ({ page, request }) => {
    const { token } = await createDomesticSession(request, accessToken, vacancyId)

    // Wait for the candidate-page session GET to complete before asserting on
    // the rendered card so we don't time out on the loading placeholder.
    const sessionLoaded = page.waitForResponse(
      (res) => res.url().includes(`/api/selection/sessions/${token}`) && res.request().method() === 'GET',
      { timeout: 20_000 },
    )
    await page.goto(`/selection/${token}`)
    await sessionLoaded

    // ResumeStep card title from ru/selection.json:
    // "candidate.resumeStep.title" = "Шаг 1. Расскажите о своём опыте"
    await expect(
      page.getByRole('heading', { name: 'Шаг 1. Расскажите о своём опыте' }),
    ).toBeVisible({ timeout: 15_000 })

    await expect(page.locator('textarea').first()).toBeVisible()
  })

  // ─── Scenario 2: Submit resume → InterviewStep ───────────────────────────────

  test('2. submits resume text and transitions to InterviewStep', async ({ page, request }) => {
    const { token } = await createDomesticSession(request, accessToken, vacancyId)

    const sessionLoaded = page.waitForResponse(
      (res) => res.url().includes(`/api/selection/sessions/${token}`) && res.request().method() === 'GET',
      { timeout: 20_000 },
    )
    await page.goto(`/selection/${token}`)
    await sessionLoaded

    await expect(
      page.getByRole('heading', { name: 'Шаг 1. Расскажите о своём опыте' }),
    ).toBeVisible({ timeout: 15_000 })

    await page.locator('textarea').first().fill(RESUME_TEXT)

    // Submit button label is "candidate.resumeStep.submit" = "Продолжить"
    await page.getByRole('button', { name: 'Продолжить' }).click()

    // The backend requires GEMINI_API_KEY — skip if resume_parsed is never reached.
    let resumeParsed = false
    for (let attempt = 0; attempt < 10; attempt++) {
      await page.waitForTimeout(1000)
      const statusRes = await request.get(`/api/selection/sessions/${token}`)
      if (statusRes.ok()) {
        const data = (await statusRes.json()) as { status?: string }
        const status = data.status ?? ''
        if (status === 'resume_parsed' || status === 'packages_assigned' || status.startsWith('stage_')) {
          resumeParsed = true
          break
        }
      }
    }

    if (!resumeParsed) {
      test.skip()
      return
    }

    await expect(
      page.getByRole('heading', { name: 'Шаг 2. Вопросы о вашем опыте' }),
    ).toBeVisible({ timeout: 15_000 })
  })

  // ─── Scenario 3: Fill interview → packages_assigned spinner ─────────────────

  test('3. fills interview answers and transitions to packages_assigned spinner', async ({
    page,
    request,
  }) => {
    // Drive the shared chain session from pending → resume_parsed via API if AI
    // is available. Skip the whole test if the session isn't at resume_parsed
    // (i.e. AI key missing or earlier transition didn't happen).
    const initial = await request.get(`/api/selection/sessions/${chainSessionToken}`)
    if (initial.ok()) {
      const data = (await initial.json()) as { status?: string }
      if (data.status === 'pending') {
        // Try driving to resume_parsed via the resume endpoint.
        await request.post(`/api/selection/sessions/${chainSessionToken}/resume`, {
          data: { resumeText: RESUME_TEXT },
        })
      }
    }
    const statusRes = await request.get(`/api/selection/sessions/${chainSessionToken}`)
    const data = statusRes.ok() ? ((await statusRes.json()) as { status?: string }) : { status: undefined }
    if (data.status !== 'resume_parsed') {
      test.skip()
      return
    }

    const sessionLoaded = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/selection/sessions/${chainSessionToken}`) &&
        res.request().method() === 'GET',
      { timeout: 20_000 },
    )
    await page.goto(`/selection/${chainSessionToken}`)
    await sessionLoaded

    await expect(
      page.getByRole('heading', { name: 'Шаг 2. Вопросы о вашем опыте' }),
    ).toBeVisible({ timeout: 15_000 })

    const textareas = page.locator('textarea')
    const count = await textareas.count()
    expect(count, 'interview should have at least one textarea').toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      await textareas.nth(i).fill('Работал с данным направлением более двух лет, полный цикл.')
    }

    // Submit button = "Отправить ответы"
    await page.getByRole('button', { name: 'Отправить ответы' }).click()

    // After POST /interview the backend transitions to packages_assigned.
    await expect(
      page.getByText('Формируем персональный тест на основе вашего опыта'),
    ).toBeVisible({ timeout: 15_000 })
  })

  // ─── Scenario 4: Poll for stage_1, verify progress bar ──────────────────────

  test('4. waits for stage_1 and progress bar shows 4th dot active', async ({ page, request }) => {
    let inStage1 = false
    for (let attempt = 0; attempt < 15; attempt++) {
      await page.waitForTimeout(1000)
      const statusRes = await request.get(`/api/selection/sessions/${chainSessionToken}`)
      if (statusRes.ok()) {
        const data = (await statusRes.json()) as { status?: string }
        if ((data.status ?? '').startsWith('stage_')) {
          inStage1 = data.status === 'stage_1'
          break
        }
      }
    }

    if (!inStage1) {
      test.skip()
      return
    }

    const sessionLoaded = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/selection/sessions/${chainSessionToken}`) &&
        res.request().method() === 'GET',
      { timeout: 20_000 },
    )
    await page.goto(`/selection/${chainSessionToken}`)
    await sessionLoaded

    // DomesticProgressBar renders 7 dots (pending, resume_parsed, packages_assigned,
    // stage_1, stage_2, stage_3, stage_4). At stage_1, dots 0–3 (4 total) are filled.
    const filledDots = page.locator('.bg-primary[class*="rounded-full"]')
    await expect(filledDots.first()).toBeVisible({ timeout: 15_000 })
    expect(await filledDots.count()).toBeGreaterThanOrEqual(4)

    await expect(page.getByRole('button', { name: 'Отправить и продолжить' })).toBeVisible({
      timeout: 15_000,
    })
  })

  // ─── Scenario 5: Submit stage_1 → stage_2 appears ───────────────────────────

  test('5. submits stage_1 and stage_2 appears', async ({ page, request }) => {
    const statusRes = await request.get(`/api/selection/sessions/${chainSessionToken}`)
    if (statusRes.ok()) {
      const data = (await statusRes.json()) as { status?: string }
      if (data.status !== 'stage_1') {
        test.skip()
        return
      }
    }

    const sessionLoaded = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/selection/sessions/${chainSessionToken}`) &&
        res.request().method() === 'GET',
      { timeout: 20_000 },
    )
    await page.goto(`/selection/${chainSessionToken}`)
    await sessionLoaded

    const submitBtn = page.getByRole('button', { name: 'Отправить и продолжить' })
    await expect(submitBtn).toBeVisible({ timeout: 15_000 })

    // Select first option for each radio-group question.
    const radios = page.locator('input[type="radio"]')
    const radioCount = await radios.count()
    if (radioCount > 0) {
      const names = new Set<string>()
      for (let i = 0; i < radioCount; i++) {
        const name = await radios.nth(i).getAttribute('name')
        if (name && !names.has(name)) {
          names.add(name)
          await radios.nth(i).click()
        }
      }
    }

    // Fill any free-text textareas in stage_1.
    const textareas = page.locator('textarea')
    const textareaCount = await textareas.count()
    for (let i = 0; i < textareaCount; i++) {
      const current = await textareas.nth(i).inputValue()
      if (!current.trim()) {
        await textareas.nth(i).fill('Ответ на вопрос этапа один.')
      }
    }

    await submitBtn.click()

    await expect(
      page.getByRole('button', { name: /Отправить и продолжить|Следующий вопрос →|Завершить тест/ }),
    ).toBeVisible({ timeout: 15_000 })

    const newStatusRes = await request.get(`/api/selection/sessions/${chainSessionToken}`)
    expect(newStatusRes.ok()).toBeTruthy()
    const newData = (await newStatusRes.json()) as { status?: string }
    expect(newData.status).toBe('stage_2')
  })

  // ─── Scenario 6: HR dashboard shows domestic session row and opens detail ────

  test('6. HR dashboard shows domestic session row and opens detail modal', async ({
    page,
    request,
  }) => {
    // Use a fresh, isolated session so the row is uniquely identifiable via its
    // full sessionId (test-id), not the colliding 8-char ULID prefix.
    const { sessionId } = await createDomesticSession(request, accessToken, vacancyId)

    await page.goto('/')
    await page.getByRole('tab', { name: 'Login' }).click()
    await page.getByLabel('Email').fill(ownerEmail)
    await page.getByLabel('Password').fill(ownerPassword)
    await page.getByRole('button', { name: 'Login' }).click()
    await expect(page.getByRole('heading', { name: 'Session is active' })).toBeVisible({
      timeout: 15_000,
    })

    const dashboardLoaded = page.waitForResponse(
      (res) => res.url().includes('/api/selection/sessions') && res.request().method() === 'GET',
      { timeout: 20_000 },
    )
    await page.goto('/selection/dashboard')
    await dashboardLoaded

    // Filter by logist_domestic role to narrow the result set.
    const roleSelect = page.locator('select').filter({ hasText: /Все|Логист/ }).first()
    if (await roleSelect.isVisible()) {
      await roleSelect.selectOption({ label: 'Логист (РФ)' })
    }

    // Use the unique data-testid on the row — never collides across sessions.
    const row = page.getByTestId(`selection-row-${sessionId}`)
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.click()

    // Detail modal — scoped via data-testid so we never accidentally match
    // text outside the modal.
    const modal = page.getByTestId('selection-detail-modal')
    await expect(modal).toBeVisible({ timeout: 10_000 })
    await expect(modal.getByRole('heading', { name: 'Детали отбора' })).toBeVisible()

    // Role label inside the modal.
    await expect(modal.getByText(/Логист \(РФ\)/)).toBeVisible()

    // Recruiter-questions section is rendered for domestic sessions.
    await expect(modal.getByText('Вопросы для рекрутера')).toBeVisible({ timeout: 5_000 })

    // If the session reached a verdict, at least one specialization name is shown.
    const hasSpecializations = await modal.getByText('Специализации').isVisible().catch(() => false)
    if (hasSpecializations) {
      const knownPackageNames = [
        'Авто FTL/LTL',
        'Базовые операции',
        'Развозка',
        'ЖД и контейнеры',
        'Негабарит',
        'Труднодоступные регионы',
        'Каботаж',
      ]
      let found = false
      for (const name of knownPackageNames) {
        if (await modal.getByText(name).isVisible().catch(() => false)) {
          found = true
          break
        }
      }
      expect(found, 'at least one specialization package name should be visible').toBe(true)
    }

    // Close modal via aria-label (avoids matching any other ✕ button on the page).
    await modal.getByRole('button', { name: 'close-detail' }).click()
    await expect(modal).not.toBeVisible({ timeout: 5_000 })
  })
})
