import { useTranslation } from 'react-i18next'

export function ReviewsPage() {
  const { t } = useTranslation('portal')
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-12">
      <h1>{t('reviews.title')}</h1>
      <p>{t('reviews.description')}</p>
      <p>
        <em>{t('reviews.soon')}</em>
      </p>
    </section>
  )
}
