export const TEST_IDS = {
  auth: {
    dashboard: 'auth.dashboard',
    emailInput: 'auth.email-input',
    loginTab: 'auth.login-tab',
    logoutButton: 'auth.logout-button',
    nameInput: 'auth.name-input',
    passwordInput: 'auth.password-input',
    registerTab: 'auth.register-tab',
    submitButton: 'auth.submit-button',
    userEmail: 'auth.user-email',
  },
  components: {
    catalog: 'components.catalog',
    title: 'components.title',
  },
  // Phase 11 — HR dashboard (recruiter / hr_admin)
  hrDashboard: {
    screen: 'hr-dashboard.screen',
    headcountKpi: 'hr-dashboard.headcount-kpi',
    pendingOffersCard: 'hr-dashboard.pending-offers',
    interviewsCard: 'hr-dashboard.interviews',
    approveOfferButton: 'hr-dashboard.approve-offer',
    rejectOfferButton: 'hr-dashboard.reject-offer',
  },
  // Phase 11 — employee portal (onboarding, 1:1, OKR, knowledge)
  portal: {
    screen: 'portal.screen',
    onboardingChecklist: 'portal.onboarding-checklist',
    documents: 'portal.documents',
    probationStatus: 'portal.probation-status',
    oneOnOneAgenda: 'portal.one-on-one.agenda',
    oneOnOneNotes: 'portal.one-on-one.notes',
    okrList: 'portal.okrs',
    knowledgeSearch: 'portal.knowledge.search',
  },
  // Phase 11 — push device registration
  devices: {
    registerButton: 'devices.register-button',
    status: 'devices.status',
  },
  details: {
    backButton: 'details.back-button',
    openButton: 'details.open-button',
    screen: 'details.screen',
  },
  screen: {
    backButton: 'screen.back-button',
  },
  tabs: {
    componentsTab: 'tabs.components',
    profileTab: 'tabs.profile',
  },
} as const;
