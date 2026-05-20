import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

import { AppPage, HomePage, RootLayout } from './pages'
import {
  AdminAuditLogPage,
  AdminUsersPage,
  ApplicationDetailPage,
  ApplicationsPage,
  RequisitionDetailPage,
  RequisitionsNewPage,
  RequisitionsPage,
  VacanciesPage,
  VacancyDetailPage,
} from './pages/recruiting'

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

const routeTree = rootRoute.addChildren([
  indexRoute,
  appRoute,
  requisitionsRoute,
  requisitionsNewRoute,
  requisitionDetailRoute,
  vacanciesRoute,
  vacancyDetailRoute,
  applicationsRoute,
  applicationDetailRoute,
  adminUsersRoute,
  adminAuditLogRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
