import { useTranslation } from 'react-i18next'

export function AlumniPage() {
  const { t } = useTranslation('portal')
  return (
    <div style={{ padding: '2rem' }}>
      <h1>{t('alumni.title')}</h1>
      <p>{t('alumni.description')}</p>
      <p>
        <em>{t('alumni.soon')}</em>
      </p>
    </div>
  )
}
