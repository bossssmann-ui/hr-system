import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { persistLanguagePreference, supportedLngs, type SupportedLng } from '@/i18n'

const LABELS: Record<SupportedLng, string> = {
  ru: 'RU',
  en: 'EN',
}

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation('common')
  const current = (i18n.resolvedLanguage ?? i18n.language ?? 'ru').slice(0, 2) as SupportedLng

  return (
    <div
      role="group"
      aria-label={t('labels.language')}
      className="inline-flex items-center gap-0.5 rounded-full border bg-background p-0.5"
    >
      {supportedLngs.map((lng) => {
        const isActive = current === lng
        return (
          <Button
            key={lng}
            type="button"
            variant={isActive ? 'secondary' : 'ghost'}
            size="sm"
            className={cn('h-7 min-w-9 rounded-full px-2 text-xs', isActive && 'font-semibold')}
            aria-pressed={isActive}
            onClick={() => {
              if (!isActive) {
                persistLanguagePreference(lng)
                void i18n.changeLanguage(lng)
              }
            }}
          >
            {LABELS[lng]}
          </Button>
        )
      })}
    </div>
  )
}
