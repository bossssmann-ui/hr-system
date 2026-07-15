import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import enEngagement from './locales/en/engagement.json'
import enLearning from './locales/en/learning.json'
import enPerformance from './locales/en/performance.json'
import enAdmin from './locales/en/admin.json'
import enAnalytics from './locales/en/analytics.json'
import enAuth from './locales/en/auth.json'
import enCandidates from './locales/en/candidates.json'
import enCareers from './locales/en/careers.json'
import enComp from './locales/en/comp.json'
import enCommon from './locales/en/common.json'
import enEmployees from './locales/en/employees.json'
import enInbox from './locales/en/inbox.json'
import enNavigation from './locales/en/navigation.json'
import enNotifications from './locales/en/notifications.json'
import enOffers from './locales/en/offers.json'
import enPortal from './locales/en/portal.json'
import enRecruiting from './locales/en/recruiting.json'
import enRequisitions from './locales/en/requisitions.json'
import enSelection from './locales/en/selection.json'
import enSettings from './locales/en/settings.json'
import ruEngagement from './locales/ru/engagement.json'
import ruLearning from './locales/ru/learning.json'
import ruPerformance from './locales/ru/performance.json'
import ruAdmin from './locales/ru/admin.json'
import ruAnalytics from './locales/ru/analytics.json'
import ruAuth from './locales/ru/auth.json'
import ruCandidates from './locales/ru/candidates.json'
import ruCareers from './locales/ru/careers.json'
import ruComp from './locales/ru/comp.json'
import ruCommon from './locales/ru/common.json'
import ruEmployees from './locales/ru/employees.json'
import ruInbox from './locales/ru/inbox.json'
import ruNavigation from './locales/ru/navigation.json'
import ruNotifications from './locales/ru/notifications.json'
import ruOffers from './locales/ru/offers.json'
import ruPortal from './locales/ru/portal.json'
import ruRecruiting from './locales/ru/recruiting.json'
import ruRequisitions from './locales/ru/requisitions.json'
import ruSelection from './locales/ru/selection.json'
import ruSettings from './locales/ru/settings.json'

export const defaultNS = 'common'

export const resources = {
  ru: {
    common: ruCommon,
    navigation: ruNavigation,
    auth: ruAuth,
    employees: ruEmployees,
    candidates: ruCandidates,
    offers: ruOffers,
    portal: ruPortal,
    requisitions: ruRequisitions,
    analytics: ruAnalytics,
    admin: ruAdmin,
    settings: ruSettings,
    recruiting: ruRecruiting,
    comp: ruComp,
    inbox: ruInbox,
    careers: ruCareers,
    selection: ruSelection,
    notifications: ruNotifications,
    performance: ruPerformance,
    engagement: ruEngagement,
    learning: ruLearning,
  },
  en: {
    common: enCommon,
    navigation: enNavigation,
    auth: enAuth,
    employees: enEmployees,
    candidates: enCandidates,
    offers: enOffers,
    portal: enPortal,
    requisitions: enRequisitions,
    analytics: enAnalytics,
    admin: enAdmin,
    settings: enSettings,
    recruiting: enRecruiting,
    comp: enComp,
    inbox: enInbox,
    careers: enCareers,
    selection: enSelection,
    notifications: enNotifications,
    performance: enPerformance,
    engagement: enEngagement,
    learning: enLearning,
  },
} as const

export const supportedLngs = ['ru', 'en'] as const
export type SupportedLng = (typeof supportedLngs)[number]

// Single source of truth for the default UI language. Used both for i18next
// initialization (`lng`) and for the <html lang="…"> sync helper below.
export const defaultLng: SupportedLng = 'ru'
const explicitLanguagePreferenceKey = 'onboardixLanguagePreferenceExplicit'

/**
 * Language for i18next init.
 * - SSR: always `defaultLng` (ru)
 * - Browser without an explicit user choice: `undefined` so LanguageDetector
 *   can use localStorage / navigator (Playwright E2E stays on en-US)
 * - Browser after LanguageSwitcher: honour the stored preference
 */
export function initialLng(): SupportedLng | undefined {
  if (typeof window === 'undefined') return defaultLng

  if (window.localStorage.getItem(explicitLanguagePreferenceKey) !== 'true') {
    return undefined
  }

  const stored = window.localStorage.getItem('i18nextLng')?.slice(0, 2)
  return supportedLngs.includes(stored as SupportedLng) ? (stored as SupportedLng) : defaultLng
}

export function persistLanguagePreference(lng: SupportedLng) {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(explicitLanguagePreferenceKey, 'true')
  window.localStorage.setItem('i18nextLng', lng)
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLng(),
    fallbackLng: 'en',
    supportedLngs: [...supportedLngs],
    nonExplicitSupportedLngs: true,
    defaultNS,
    ns: [
      'common',
      'navigation',
      'auth',
      'employees',
      'candidates',
      'offers',
      'portal',
      'requisitions',
      'analytics',
      'admin',
      'settings',
      'recruiting',
      'comp',
      'inbox',
      'careers',
      'selection',
      'notifications',
      'performance',
      'engagement',
      'learning',
    ],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
    returnNull: false,
  })

// Keep the <html lang="…"> attribute in sync with the active language so that
// assistive tech, browser features (translation, hyphenation), and SSR snapshots
// match the UI language. Runs once on init and again on every language change.
if (typeof document !== 'undefined') {
  const applyHtmlLang = (lng: string | undefined) => {
    const next = (lng ?? defaultLng).slice(0, 2)
    if (supportedLngs.includes(next as SupportedLng)) {
      document.documentElement.setAttribute('lang', next)
    }
  }
  applyHtmlLang(i18n.resolvedLanguage ?? i18n.language)
  i18n.on('languageChanged', applyHtmlLang)
}

export default i18n
