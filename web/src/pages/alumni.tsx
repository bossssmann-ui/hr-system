import { useTranslation } from 'react-i18next'

export function AlumniPage() {
  const { t } = useTranslation('portal')
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-12">
      <h1>{t('alumni.title')}</h1>
      <p>{t('alumni.description')}</p>
      <p>
        <em>{t('alumni.soon')}</em>
      </p>
    </section>
  )
}
