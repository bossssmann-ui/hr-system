import { expect, test, uniqueEmail } from '../helpers/test'

const ownerEmail = process.env.BOOTSTRAP_OWNER_EMAIL ?? 'e2e-owner@example.com'
const ownerPassword = process.env.BOOTSTRAP_OWNER_PASSWORD ?? 'E2eOwnerPass1!'

test.describe('Phase 1D public assessment flow', () => {
  let accessToken: string

  test.beforeAll(async ({ request }) => {
    const loginRes = await request.post('/api/auth/login', {
      data: { email: ownerEmail, password: ownerPassword },
    })
    expect(loginRes.ok(), `owner login failed status=${loginRes.status()}`).toBeTruthy()
    const loginBody = await loginRes.json()
    accessToken = loginBody.accessToken as string
  })

  test('candidate takes tokenized assessment and recruiter sees trust score', async ({ page, request }) => {
    const api = async (method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) => {
      const res = await request[method === 'GET' ? 'get' : method === 'POST' ? 'post' : 'patch'](path, {
        data: body,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })
      return res
    }

    const org = await api('POST', '/api/org-units', { name: 'Assessment E2E Unit' })
    expect(org.ok()).toBeTruthy()
    const orgId = (await org.json()).id as string

    const reqCreate = await api('POST', '/api/requisitions', {
      orgUnitId: orgId,
      title: 'Assessment E2E Role',
      grade: 'M3',
      salaryMin: 100000,
      salaryMax: 150000,
      currency: 'RUB',
      justification: 'Assessment flow',
    })
    expect(reqCreate.ok()).toBeTruthy()
    const requisitionId = (await reqCreate.json()).id as string
    for (const status of ['submitted', 'manager_approved', 'hr_approved', 'approved'] as const) {
      const t = await api('PATCH', `/api/requisitions/${requisitionId}/transition`, { to: status })
      expect(t.ok()).toBeTruthy()
    }

    const vacanciesRes = await api('GET', '/api/vacancies')
    expect(vacanciesRes.ok()).toBeTruthy()
    const vacancy = ((await vacanciesRes.json()).items as Array<{ id: string; requisitionId: string }>).find((item) => item.requisitionId === requisitionId)
    expect(vacancy).toBeDefined()

    const candidateRes = await api('POST', '/api/candidates', {
      fullName: 'Assessment Candidate',
      email: uniqueEmail('assessment-candidate'),
    })
    expect(candidateRes.ok()).toBeTruthy()
    const candidateId = (await candidateRes.json()).candidate.id as string

    const appRes = await api('POST', '/api/applications', { candidateId, vacancyId: vacancy!.id })
    expect(appRes.ok()).toBeTruthy()
    const applicationId = (await appRes.json()).id as string

    const templateRes = await api('POST', '/api/assessments/templates', {
      title: 'E2E Assessment',
      timeLimitMin: 30,
      questions: [
        {
          order: 1,
          type: 'single_choice',
          prompt: 'HTTP stands for?',
          options: ['Hypertext Transfer Protocol', 'High Task Tool'],
          weight: 1,
        },
      ],
    })
    expect(templateRes.ok()).toBeTruthy()
    const templateId = (await templateRes.json()).id as string

    const inviteRes = await api('POST', `/api/assessments/${templateId}/invite`, { applicationId })
    expect(inviteRes.ok()).toBeTruthy()
    const invite = await inviteRes.json()
    const assessmentToken = invite.token as string

    await page.goto(`/assessment/${assessmentToken}`)
    await page.getByTestId('assessment-consent-checkbox').check()
    await page.getByTestId('assessment-consent-submit').click()
    await page.getByTestId('assessment-start-button').click()
    await page.locator('select').first().selectOption({ label: 'Hypertext Transfer Protocol' })
    await page.getByTestId('assessment-submit-button').click()

    const sessionsRes = await api('GET', `/api/assessments/sessions?applicationId=${applicationId}`)
    expect(sessionsRes.ok()).toBeTruthy()
    const sessions = (await sessionsRes.json()).items as Array<{ trustScore: number | null }>
    expect(sessions.length).toBeGreaterThan(0)
    expect('trustScore' in sessions[0]!).toBeTruthy()
  })
})
