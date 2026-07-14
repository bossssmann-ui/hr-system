import { useTranslation } from 'react-i18next'

export function ReviewsPage() {
  const { t } = useTranslation('portal')
  return (
    <div style={{ padding: '2rem' }}>
      <h1>{t('reviews.title')}</h1>
      <p>{t('reviews.description')}</p>
      <p>
        <em>{t('reviews.soon')}</em>
      </p>
    </div>
  )
}
