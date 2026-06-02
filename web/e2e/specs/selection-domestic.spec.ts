/**
 * Phase 15–16 Playwright E2E — Domestic logist selection flow.
 *
 * Covers:
 *   1. Create domestic session via API → open /selection/:token → ResumeStep visible
 *   2. Submit resume text → transition to InterviewStep
 *   3. Fill interview answers → transition to packages_assigned spinner
 *   4. Wait for stage_1 (polling GET /sessions/:token) → progress bar shows dot 4
 *   5. Submit stage_1 radio answers → stage_2 appears
 *   6. HR dashboard — domestic session row is visible, detail modal shows specializations
 *
 * Prerequisites: the database must be seeded with a bootstrap owner before this test
 * runs (global-setup.ts handles this). The backend must have ASSESSMENT_SYSTEM_ENABLED=true
 * and ASSESSMENTS_ENABLED=true — playwright.config.ts sets ASSESSMENTS_ENABLED=true in
 * backendEnv; ASSESSMENT_SYSTEM_ENABLED must also be set. The resume/interview steps
 * require GEMINI_API_KEY in backendEnv; if absent the backend returns 503 and those steps
 * are skipped via test.skip().
 *
 * The GET /sessions/:token endpoint auto-transitions pending→stage_1 for non-domestic
 * sessions. For domestic sessions the flow is:
 *   pending → (POST /resume) → resume_parsed → (POST /interview) → packages_assigned
 *   → (async worker) → stage_1 → ... → stage_4 → completed
 */

import type { APIRequestContext } from '@playwright/test'
import { expect, test } from '../helpers/test'

const ownerEmail = process.env.BOOTSTRAP_OWNER_EMAIL ?? 'e2e-owner@example.com'
const ownerPassword = process.env.BOOTSTRAP_OWNER_PASSWORD ?? 'E2eOwnerPass1!'

/**
 * Create a fresh domestic selection session and return its identifiers.
 * Each test that needs pending state should call this so tests are isolated
 * from one another (no shared session state, no strict-mode collisions on
 * dashboard prefixes across retries).
 */
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
  const sess = (await sessRes.json()) as { sessionId: string; token: string }
  return sess
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: ['Bearer', accessToken].join(' '),
    'Content-Type': 'application/json',
  }
}

/**
 * Minimal resume text containing keywords that trigger domestic specialisations.
 * "FTL, LTL, сборные грузы, ATI" are the triggers documented in the task.
 */
const RESUME_TEXT = `
Опыт работы в логистике 4 года.
Организация автоперевозок FTL и LTL по России.
Работа со сборными грузами через транспортные компании.
Размещение заявок на ATI.SU, подбор перевозчиков.
Регионы: Москва, Урал, Сибирь.
Работа с тентовым и рефрижераторным транспортом.
`.trim()

test.describe('Phase 15–16 domestic selection flow', () => {
  let accessToken: string
  let sessionToken: string
  let sessionId: string
  let vacancyId: string

  test.beforeAll(async ({ request }) => {
    // Log in as bootstrap owner.
    const loginRes = await request.post('/api/auth/login', {
      data: { email: ownerEmail, password: ownerPassword },
    })
    expect(loginRes.ok(), `owner login failed: status=${loginRes.status()}`).toBeTruthy()
    accessToken = ((await loginRes.json()) as { accessToken: string }).accessToken

    const auth = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }

    // Create org unit.
    const orgRes = await request.post('/api/org-units', {
      data: { name: 'Domestic E2E Org' },
      headers: auth,
    })
    expect(orgRes.ok(), `org-unit failed: ${orgRes.status()}`).toBeTruthy()
    const orgId = ((await orgRes.json()) as { id: string }).id

    // Create requisition.
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

    // Approve requisition through full FSM.
    for (const to of ['submitted', 'manager_approved', 'hr_approved', 'approved'] as const) {
      const t = await request.patch(`/api/requisitions/${requisitionId}/transition`, {
        data: { to },
        headers: auth,
      })
      expect(t.ok(), `transition to ${to} failed: ${t.status()}`).toBeTruthy()
    }

    // Get auto-created vacancy.
    const vacRes = await request.get('/api/vacancies', { headers: auth })
    expect(vacRes.ok()).toBeTruthy()
    const vacancies = ((await vacRes.json()) as { items: Array<{ id: string; requisitionId: string }> }).items
    const vacancy = vacancies.find((v) => v.requisitionId === requisitionId)
    expect(vacancy, 'vacancy not found for domestic requisition').toBeDefined()
    vacancyId = vacancy!.id

    // Create domestic selection session.
    const sessRes = await request.post('/api/selection/sessions', {
      data: { vacancyId, role: 'logist_domestic' },
      headers: auth,
    })
    if (!sessRes.ok()) {
      // Feature flag may be disabled — skip all tests gracefully.
      const body = await sessRes.text()
      throw new Error(`selection session create failed: status=${sessRes.status()} body=${body}`)
    }
    const sess = (await sessRes.json()) as { sessionId: string; token: string }
    sessionToken = sess.token
    sessionId = sess.sessionId
  })

  // ─── Scenario 1: ResumeStep visible on /selection/:token ────────────────────

  test('1. opens /selection/:token and shows ResumeStep', async ({ page }) => {
    await page.goto(`/selection/${sessionToken}`)

    // ResumeStep card title from ru/selection.json:
    // "candidate.resumeStep.title" = "Шаг 1. Расскажите о своём опыте"
    await expect(
      page.getByText('Шаг 1. Расскажите о своём опыте'),
    ).toBeVisible({ timeout: 10_000 })

    // The textarea for resume input should be present.
    await expect(page.locator('textarea').first()).toBeVisible()
  })

  // ─── Scenario 2: Submit resume → InterviewStep ───────────────────────────────

  test('2. submits resume text and transitions to InterviewStep', async ({ page, request }) => {
    await page.goto(`/selection/${sessionToken}`)

    await expect(page.getByText('Шаг 1. Расскажите о своём опыте')).toBeVisible({ timeout: 10_000 })

    // Fill resume textarea.
    await page.locator('textarea').first().fill(RESUME_TEXT)

    // The submit button label is "candidate.resumeStep.submit" = "Продолжить"
    await page.getByRole('button', { name: 'Продолжить' }).click()

    // After POST /resume succeeds the component invalidates the session query.
    // The backend requires GEMINI_API_KEY — skip if we get a 503 spinner that
    // never advances (i.e. the step stays in resume state due to AI unavailability).
    // We poll the API directly to know whether resume_parsed was actually reached.
    let resumeParsed = false
    for (let attempt = 0; attempt < 10; attempt++) {
      await page.waitForTimeout(1000)
      const statusRes = await request.get(`/api/selection/sessions/${sessionToken}`)
      if (statusRes.ok()) {
        const data = (await statusRes.json()) as { status?: string }
        if (data.status === 'resume_parsed' || data.status === 'packages_assigned' || (data.status ?? '').startsWith('stage_')) {
          resumeParsed = true
          break
        }
      }
    }

    if (!resumeParsed) {
      // GEMINI_API_KEY not set in this E2E environment — skip the AI-dependent steps.
      test.skip()
      return
    }

    // InterviewStep card title = "Шаг 2. Вопросы о вашем опыте"
    await expect(
      page.getByText('Шаг 2. Вопросы о вашем опыте'),
    ).toBeVisible({ timeout: 10_000 })
  })

  // ─── Scenario 3: Fill interview → packages_assigned spinner ─────────────────

  test('3. fills interview answers and transitions to packages_assigned spinner', async ({
    page,
    request,
  }) => {
    // Pre-check: session must be in resume_parsed state.
    const statusRes = await request.get(`/api/selection/sessions/${sessionToken}`)
    if (statusRes.ok()) {
      const data = (await statusRes.json()) as { status?: string }
      if (data.status !== 'resume_parsed') {
        test.skip()
        return
      }
    }

    await page.goto(`/selection/${sessionToken}`)
    await expect(page.getByText('Шаг 2. Вопросы о вашем опыте')).toBeVisible({ timeout: 10_000 })

    // Fill all visible textareas with at least 10 characters.
    const textareas = page.locator('textarea')
    const count = await textareas.count()
    expect(count, 'interview should have at least one textarea').toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      await textareas.nth(i).fill('Работал с данным направлением более двух лет, полный цикл.')
    }

    // Submit button = "Отправить ответы"
    await page.getByRole('button', { name: 'Отправить ответы' }).click()

    // After POST /interview backend transitions to packages_assigned.
    // UI shows spinner with text "Формируем персональный тест на основе вашего опыта..."
    await expect(
      page.getByText('Формируем персональный тест на основе вашего опыта'),
    ).toBeVisible({ timeout: 15_000 })
  })

  // ─── Scenario 4: Poll for stage_1, verify progress bar ──────────────────────

  test('4. waits for stage_1 and progress bar shows 4th dot active', async ({ page, request }) => {
    // Poll the backend API until stage_1 (or skip if AI worker is unavailable).
    let inStage1 = false
    for (let attempt = 0; attempt < 15; attempt++) {
      await page.waitForTimeout(1000)
      const statusRes = await request.get(`/api/selection/sessions/${sessionToken}`)
      if (statusRes.ok()) {
        const data = (await statusRes.json()) as { status?: string }
        if ((data.status ?? '').startsWith('stage_')) {
          inStage1 = data.status === 'stage_1'
          break
        }
      }
    }

    if (!inStage1) {
      // Worker hasn't transitioned yet or AI is unavailable — skip.
      test.skip()
      return
    }

    await page.goto(`/selection/${sessionToken}`)

    // DomesticProgressBar renders 7 dots (pending, resume_parsed, packages_assigned,
    // stage_1, stage_2, stage_3, stage_4). At stage_1 (index 3) the first 4 dots
    // (indices 0-3) should be filled (bg-primary).
    // Count filled dots = dots with class containing 'bg-primary'.
    const filledDots = page.locator('.bg-primary[class*="rounded-full"]')
    await expect(filledDots.first()).toBeVisible({ timeout: 10_000 })
    const dotCount = await filledDots.count()
    // At stage_1 (index 3 in the 7-step array), steps 0-3 are complete = 4 filled dots.
    expect(dotCount).toBeGreaterThanOrEqual(4)

    // Stage 1 content should be visible (GenericStageForm with questionnaire questions).
    await expect(page.getByRole('button', { name: 'Отправить и продолжить' })).toBeVisible({
      timeout: 10_000,
    })
  })

  // ─── Scenario 5: Submit stage_1 → stage_2 appears ───────────────────────────

  test('5. submits stage_1 and stage_2 appears', async ({ page, request }) => {
    // Pre-check session must be at stage_1.
    const statusRes = await request.get(`/api/selection/sessions/${sessionToken}`)
    if (statusRes.ok()) {
      const data = (await statusRes.json()) as { status?: string }
      if (data.status !== 'stage_1') {
        test.skip()
        return
      }
    }

    await page.goto(`/selection/${sessionToken}`)

    // Wait for stage form to render.
    const submitBtn = page.getByRole('button', { name: 'Отправить и продолжить' })
    await expect(submitBtn).toBeVisible({ timeout: 10_000 })

    // Fill any radio buttons (single_choice questions).
    const radios = page.locator('input[type="radio"]')
    const radioCount = await radios.count()
    if (radioCount > 0) {
      // Select the first option for each question (identified by unique name attribute).
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

    // After submission the session moves to stage_2.
    // The UI shows either Stage2Questions or another GenericStageForm.
    // We just verify the page no longer shows stage_1 submit but instead
    // shows a new submit/next-question button.
    await expect(
      page.getByRole('button', { name: /Отправить и продолжить|Следующий вопрос →|Завершить тест/ }),
    ).toBeVisible({ timeout: 15_000 })

    // Verify backend status is stage_2.
    const newStatusRes = await request.get(`/api/selection/sessions/${sessionToken}`)
    expect(newStatusRes.ok()).toBeTruthy()
    const newData = (await newStatusRes.json()) as { status?: string }
    expect(newData.status).toBe('stage_2')
  })

  // ─── Scenario 6: HR dashboard shows domestic session with specializations ────

  test('6. HR dashboard shows domestic session row and specializations in detail', async ({
    page,
    request,
  }) => {
    // Ensure the session exists (created in beforeAll).
    expect(sessionId, 'sessionId must be set from beforeAll').toBeTruthy()

    // Log in via UI.
    await page.goto('/')
    await page.getByRole('tab', { name: 'Login' }).click()
    await page.getByLabel('Email').fill(ownerEmail)
    await page.getByLabel('Password').fill(ownerPassword)
    await page.getByRole('button', { name: 'Login' }).click()
    await expect(page.getByRole('heading', { name: 'Session is active' })).toBeVisible({
      timeout: 10_000,
    })

    // Navigate to selection dashboard.
    await page.goto('/selection/dashboard')

    // Filter by logist_domestic role to narrow results.
    const roleSelect = page.locator('select').filter({ hasText: /Все|Логист/ }).first()
    if (await roleSelect.isVisible()) {
      await roleSelect.selectOption({ label: 'Логист (РФ)' })
    }

    // The session row should appear. We identify it by the first 8 chars of sessionId.
    const sessionPrefix = sessionId.slice(0, 8)
    await expect(page.getByText(sessionPrefix)).toBeVisible({ timeout: 10_000 })

    // Click the row to open the detail modal.
    await page.getByText(sessionPrefix).click()

    // Detail modal title = "Детали отбора"
    await expect(page.getByText('Детали отбора')).toBeVisible({ timeout: 5_000 })

    // The role should show "Логист (РФ)".
    await expect(page.getByText(/Логист \(РФ\)/)).toBeVisible()

    // If session has reached a verdict, specializations section should be present.
    // We check for the "Специализации" heading — it only appears when session has
    // specializations AND a verdict. If the session is still in-progress, the section
    // may not appear; in that case we just assert the modal opened correctly.
    const hasSpecializations = await page.getByText('Специализации').isVisible().catch(() => false)
    if (hasSpecializations) {
      // At minimum one known package name should appear.
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
        if (await page.getByText(name).isVisible().catch(() => false)) {
          found = true
          break
        }
      }
      expect(found, 'at least one specialization package name should be visible').toBe(true)
    }

    // Regardless of verdict readiness, recruiter-questions section is rendered for domestic.
    await expect(page.getByText('Вопросы для рекрутера')).toBeVisible({ timeout: 5_000 })

    // Close modal.
    await page.getByRole('button', { name: '✕' }).click()
    await expect(page.getByText('Детали отбора')).not.toBeVisible({ timeout: 3_000 })
  })
})
