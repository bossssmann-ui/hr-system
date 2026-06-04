export type HhTokens = {
  accessToken: string
  refreshToken: string
  expiresInSeconds: number
}

export type HhEmployerVacancy = {
  id: string
  name: string
  archived?: boolean
}

export type HhNegotiationCollection = {
  id?: string
  name?: string
  type?: string
  url: string
}

export type HhNegotiationResumeRef = {
  id: string
  title?: string
  url?: string
}

export type HhNegotiation = {
  id: string
  state?: {
    id?: string
    name?: string
  }
  created_at: string
  updated_at?: string
  has_updates?: boolean
  viewed_by_opponent?: boolean
  resume?: HhNegotiationResumeRef | null
  vacancy?: {
    id?: string
    name?: string
  }
  messages_url?: string
}

export type HhNegotiationsPage = {
  found: number
  pages: number
  page: number
  per_page: number
  items: HhNegotiation[]
}

export type HhResumeContact = {
  type?: {
    id?: string
    name?: string
  }
  value?: string
}

export type HhResume = {
  id: string
  title?: string
  first_name?: string
  last_name?: string
  area?: {
    name?: string
  }
  salary?: {
    amount?: number
    currency?: string
  } | null
  total_experience?: {
    months?: number
  } | null
  experience?: Array<{
    company?: {
      name?: string
    }
    position?: string
  }>
  education?: {
    primary?: Array<{
      name?: string
      year?: number
    }>
  }
  skills?: string[]
  contact?: HhResumeContact[]
}

export type HhResumeSearchItem = {
  id: string
  title?: string
  updated_at?: string
}

export type HhResumeSearchPage = {
  found: number
  pages: number
  page: number
  per_page: number
  items: HhResumeSearchItem[]
}

export type HhNegotiationInviteResult = {
  id: string | null
  messagesUrl: string | null
}

export type HhClient = {
  getMe(accessToken: string): Promise<{ id?: string; employer?: { id?: string } }>
  exchangeAuthorizationCode(input: { code: string; redirectUri: string }): Promise<HhTokens>
  refreshAccessToken(input: { refreshToken: string }): Promise<HhTokens>
  listEmployerVacancies(accessToken: string, page?: number): Promise<HhEmployerVacancy[]>
  getNegotiationCollections(accessToken: string, vacancyId: string): Promise<HhNegotiationCollection[]>
  listNegotiations(accessToken: string, collectionUrl: string, page?: number): Promise<HhNegotiationsPage>
  listResumes(
    accessToken: string,
    criteria: Record<string, string>,
    page?: number,
  ): Promise<HhResumeSearchPage>
  getResume(accessToken: string, resumeId: string): Promise<HhResume>
  createNegotiationInvite(input: {
    accessToken: string
    resumeId: string
    vacancyId: string
    message?: string
  }): Promise<HhNegotiationInviteResult>
}
