import { useTranslation } from 'react-i18next'

export function LearningPage() {
  const { t } = useTranslation('portal')
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-12">
      <h1>{t('learning.title')}</h1>
      <p>{t('learning.description')}</p>
      <p>
        <em>{t('learning.soon')}</em>
      </p>
    </section>
  )
}
