import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import enAdmin from './locales/en/admin.json'
import enAnalytics from './locales/en/analytics.json'
import enAuth from './locales/en/auth.json'
import enCandidates from './locales/en/candidates.json'
import enCommon from './locales/en/common.json'
import enEmployees from './locales/en/employees.json'
import enNavigation from './locales/en/navigation.json'
import enOffers from './locales/en/offers.json'
import enPortal from './locales/en/portal.json'
import enRequisitions from './locales/en/requisitions.json'
import enSettings from './locales/en/settings.json'
import ruAdmin from './locales/ru/admin.json'
import ruAnalytics from './locales/ru/analytics.json'
import ruAuth from './locales/ru/auth.json'
import ruCandidates from './locales/ru/candidates.json'
import ruCommon from './locales/ru/common.json'
import ruEmployees from './locales/ru/employees.json'
import ruNavigation from './locales/ru/navigation.json'
import ruOffers from './locales/ru/offers.json'
import ruPortal from './locales/ru/portal.json'
import ruRequisitions from './locales/ru/requisitions.json'
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
  },
} as const

export const supportedLngs = ['ru', 'en'] as const
export type SupportedLng = (typeof supportedLngs)[number]

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'ru',
    supportedLngs: [...supportedLngs],
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
    ],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },
    returnNull: false,
  })

export default i18n
