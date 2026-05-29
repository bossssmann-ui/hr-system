import { useTranslation } from 'react-i18next'

export function LearningPage() {
  const { t } = useTranslation('portal')
  return (
    <div style={{ padding: '2rem' }}>
      <h1>{t('learning.title')}</h1>
      <p>{t('learning.description')}</p>
      <p>
        <em>{t('learning.soon')}</em>
      </p>
    </div>
  )
}
