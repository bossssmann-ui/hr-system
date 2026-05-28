import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

import { AppPage, HomePage, RootLayout } from './pages'
import {
  AdminAuditLogPage,
  AdminHhIntegrationPage,
  AdminUsersPage,
  ApplicationDetailPage,
  ApplicationsPage,
  CandidatesPage,
  RequisitionDetailPage,
  RequisitionsNewPage,
  RequisitionsPage,
  VacanciesPage,
  VacancyDetailPage,
} from './pages/recruiting'
import { InboxPage, ConversationPage } from './pages/inbox'
import { CareersPage, CareersVacancyPage } from './pages/careers'
import { PublicAssessmentPage } from './pages/assessment'
import { PublicSelectionPage } from './pages/selection'
import { SelectionDashboardPage } from './pages/selection-dashboard'
import { CompPage } from './pages/comp'
import { AlumniPage } from './pages/alumni'
import { AnalyticsPage } from './pages/analytics'
import { LearningPage } from './pages/learning'
import { PortalPage } from './pages/portal'
import { ReviewsPage } from './pages/reviews'
import { SettingsIntegrationsPage } from './pages/settings'

const rootRoute = createRootRoute({
  component: RootLayout,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  component: AppPage,
})

// Recruiting skeleton routes — see `web/src/pages/recruiting.tsx`. Real data
// fetching, forms, and admin tables land alongside the matching backend
// routes in Phase 0.x / Phase 1.
const requisitionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/requisitions',
  component: RequisitionsPage,
})

const requisitionsNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/requisitions/new',
  component: RequisitionsNewPage,
})

const requisitionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/requisitions/$requisitionId',
  component: RequisitionDetailPage,
})

const vacanciesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/vacancies',
  component: VacanciesPage,
})

const vacancyDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/vacancies/$vacancyId',
  component: VacancyDetailPage,
})

const applicationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/applications',
  component: ApplicationsPage,
})

const applicationDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/applications/$applicationId',
  component: ApplicationDetailPage,
})

const candidatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/candidates',
  component: CandidatesPage,
})

const adminUsersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/users',
  component: AdminUsersPage,
})

const adminAuditLogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/audit-log',
  component: AdminAuditLogPage,
})

const adminHhIntegrationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/integrations/hh',
  component: AdminHhIntegrationPage,
})

const settingsIntegrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/integrations',
  component: SettingsIntegrationsPage,
})

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inbox',
  component: InboxPage,
})

const conversationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inbox/$conversationId',
  component: ConversationPage,
})

// ─── Public careers routes (no auth required) ──────────────────────────────

const careersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/careers',
  component: CareersPage,
})

const careersVacancyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/careers/$slug',
  component: CareersVacancyPage,
})

const publicAssessmentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/assessment/$token',
  component: PublicAssessmentPage,
})

// ─── Phase 2 — Selection System routes ────────────────────────────────────

const publicSelectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/selection/$token',
  component: PublicSelectionPage,
})

const selectionDashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/selection/dashboard',
  component: SelectionDashboardPage,
})

const compRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/comp',
  component: CompPage,
})

const alumniRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/alumni',
  component: AlumniPage,
})

const portalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/portal',
  component: PortalPage,
})

const learningRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/learning',
  component: LearningPage,
})

const reviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reviews',
  component: ReviewsPage,
})

const analyticsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/analytics',
  component: AnalyticsPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  appRoute,
  requisitionsRoute,
  requisitionsNewRoute,
  requisitionDetailRoute,
  vacanciesRoute,
  vacancyDetailRoute,
  candidatesRoute,
  applicationsRoute,
  applicationDetailRoute,
  adminUsersRoute,
  adminAuditLogRoute,
  adminHhIntegrationRoute,
  settingsIntegrationsRoute,
  inboxRoute,
  conversationRoute,
  careersRoute,
  careersVacancyRoute,
  publicAssessmentRoute,
  publicSelectionRoute,
  selectionDashboardRoute,
  compRoute,
  alumniRoute,
  portalRoute,
  learningRoute,
  reviewsRoute,
  analyticsRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
