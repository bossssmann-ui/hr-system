import { useForm } from '@tanstack/react-form'
import { Link } from '@tanstack/react-router'
import {
  loginRequestSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerRequestSchema,
  type LoginRequest,
  type PasswordResetConfirmRequest,
  type PasswordResetRequest,
  type RegisterRequest,
} from '@web-app-demo/contracts'
import type { z } from 'zod'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'

type AuthMode = 'login' | 'register'
type FieldName = 'displayName' | 'email' | 'password' | 'token'
type FormError = { message?: string }
type FieldErrors = Partial<Record<FieldName, FormError[]>>
type AuthDraft = {
  email: string
  password: string
  displayName: string
}

const emptyDraft: AuthDraft = {
  email: '',
  password: '',
  displayName: '',
}

export function AuthForm() {
  const [mode, setMode] = useState<AuthMode>('register')
  const [draft, setDraft] = useState<AuthDraft>(emptyDraft)
  const { t } = useTranslation('auth')

  function updateDraft(nextDraft: Partial<AuthDraft>) {
    setDraft((currentDraft) => ({ ...currentDraft, ...nextDraft }))
  }

  return (
    <Card className="w-full" aria-label={t('title')}>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs
          value={mode}
          onValueChange={(nextMode) => {
            if (nextMode === 'login' || nextMode === 'register') {
              setMode(nextMode)
            }
          }}
          className="mb-6"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="register">{t('tabs.register')}</TabsTrigger>
            <TabsTrigger value="login">{t('tabs.login')}</TabsTrigger>
          </TabsList>

          <TabsContent value="register" forceMount hidden={mode !== 'register'} className="mt-6">
            {mode === 'register' && <RegisterForm draft={draft} onDraftChange={updateDraft} />}
          </TabsContent>
          <TabsContent value="login" forceMount hidden={mode !== 'login'} className="mt-6">
            {mode === 'login' && <LoginForm draft={draft} onDraftChange={updateDraft} />}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function RegisterForm({
  draft,
  onDraftChange,
}: {
  draft: AuthDraft
  onDraftChange: (draft: Partial<AuthDraft>) => void
}) {
  const auth = useAuth()
  const { t } = useTranslation('auth')
  const displayNameId = useId()
  const displayNameErrorId = useId()
  const emailId = useId()
  const emailErrorId = useId()
  const passwordId = useId()
  const passwordErrorId = useId()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: draft,
    onSubmit: async ({ value }) => {
      setFormError(null)

      const result = registerRequestSchema.safeParse(value)
      if (!result.success) {
        setFieldErrors(toFieldErrors(result.error.issues))
        return
      }

      setFieldErrors({})

      try {
        await auth.register(result.data as RegisterRequest)
      } catch (caughtError) {
        if (caughtError instanceof ApiRequestError) {
          setFormError(caughtError.message)
          return
        }
        setFormError(t('alerts.unexpected'))
      }
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <FieldGroup className="gap-4">
        <form.Field
          name="displayName"
          children={(field) => (
            <Field data-invalid={hasErrors(fieldErrors.displayName)}>
              <FieldLabel htmlFor={displayNameId}>{t('fields.name')}</FieldLabel>
              <Input
                id={displayNameId}
                name={field.name}
                value={field.state.value ?? ''}
                autoComplete="name"
                aria-invalid={hasErrors(fieldErrors.displayName)}
                aria-describedby={errorId(fieldErrors.displayName, displayNameErrorId)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  const value = event.target.value
                  field.handleChange(value)
                  onDraftChange({ displayName: value })
                  clearFieldError('displayName', setFieldErrors)
                  setFormError(null)
                }}
              />
              <FieldError id={displayNameErrorId} errors={fieldErrors.displayName} />
            </Field>
          )}
        />

        <form.Field
          name="email"
          children={(field) => (
            <Field data-invalid={hasErrors(fieldErrors.email)}>
              <FieldLabel htmlFor={emailId}>{t("fields.email")}</FieldLabel>
              <Input
                id={emailId}
                name={field.name}
                value={field.state.value}
                type="text"
                inputMode="email"
                autoComplete="email"
                aria-invalid={hasErrors(fieldErrors.email)}
                aria-describedby={errorId(fieldErrors.email, emailErrorId)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  const value = event.target.value
                  field.handleChange(value)
                  onDraftChange({ email: value })
                  clearFieldError('email', setFieldErrors)
                  setFormError(null)
                }}
              />
              <FieldError id={emailErrorId} errors={fieldErrors.email} />
            </Field>
          )}
        />

        <form.Field
          name="password"
          children={(field) => (
            <Field data-invalid={hasErrors(fieldErrors.password)}>
              <FieldLabel htmlFor={passwordId}>{t("fields.password")}</FieldLabel>
              <Input
                id={passwordId}
                name={field.name}
                value={field.state.value}
                type="password"
                autoComplete="new-password"
                aria-invalid={hasErrors(fieldErrors.password)}
                aria-describedby={errorId(fieldErrors.password, passwordErrorId)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  const value = event.target.value
                  field.handleChange(value)
                  onDraftChange({ password: value })
                  clearFieldError('password', setFieldErrors)
                  setFormError(null)
                }}
              />
              <FieldError id={passwordErrorId} errors={fieldErrors.password} />
            </Field>
          )}
        />

        <Button asChild type="button" variant="link" className="h-auto w-fit px-0">
          <Link to="/reset-password">{t('buttons.forgotPassword')}</Link>
        </Button>

        <FormAlert message={formError} />

        <form.Subscribe
          selector={(state) => state.isSubmitting}
          children={(isSubmitting) => (
            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t('buttons.working') : t('buttons.createAccount')}
            </Button>
          )}
        />
      </FieldGroup>
    </form>
  )
}

function LoginForm({
  draft,
  onDraftChange,
}: {
  draft: AuthDraft
  onDraftChange: (draft: Partial<AuthDraft>) => void
}) {
  const auth = useAuth()
  const { t } = useTranslation('auth')
  const emailId = useId()
  const emailErrorId = useId()
  const passwordId = useId()
  const passwordErrorId = useId()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: {
      email: draft.email,
      password: draft.password,
    },
    onSubmit: async ({ value }) => {
      setFormError(null)

      const result = loginRequestSchema.safeParse(value)
      if (!result.success) {
        setFieldErrors(toFieldErrors(result.error.issues))
        return
      }

      setFieldErrors({})

      try {
        await auth.login(result.data as LoginRequest)
      } catch (caughtError) {
        if (caughtError instanceof ApiRequestError) {
          setFormError(caughtError.message)
          return
        }
        setFormError(t('alerts.unexpected'))
      }
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <FieldGroup className="gap-4">
        <form.Field
          name="email"
          children={(field) => (
            <Field data-invalid={hasErrors(fieldErrors.email)}>
              <FieldLabel htmlFor={emailId}>{t("fields.email")}</FieldLabel>
              <Input
                id={emailId}
                name={field.name}
                value={field.state.value}
                type="text"
                inputMode="email"
                autoComplete="email"
                aria-invalid={hasErrors(fieldErrors.email)}
                aria-describedby={errorId(fieldErrors.email, emailErrorId)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  const value = event.target.value
                  field.handleChange(value)
                  onDraftChange({ email: value })
                  clearFieldError('email', setFieldErrors)
                  setFormError(null)
                }}
              />
              <FieldError id={emailErrorId} errors={fieldErrors.email} />
            </Field>
          )}
        />

        <form.Field
          name="password"
          children={(field) => (
            <Field data-invalid={hasErrors(fieldErrors.password)}>
              <FieldLabel htmlFor={passwordId}>{t("fields.password")}</FieldLabel>
              <Input
                id={passwordId}
                name={field.name}
                value={field.state.value}
                type="password"
                autoComplete="current-password"
                aria-invalid={hasErrors(fieldErrors.password)}
                aria-describedby={errorId(fieldErrors.password, passwordErrorId)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  const value = event.target.value
                  field.handleChange(value)
                  onDraftChange({ password: value })
                  clearFieldError('password', setFieldErrors)
                  setFormError(null)
                }}
              />
              <FieldError id={passwordErrorId} errors={fieldErrors.password} />
            </Field>
          )}
        />

        <FormAlert message={formError} />

        <Button asChild type="button" variant="link" className="h-auto w-fit px-0">
          <Link to="/reset-password">{t('buttons.forgotPassword')}</Link>
        </Button>

        <form.Subscribe
          selector={(state) => state.isSubmitting}
          children={(isSubmitting) => (
            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t('buttons.working') : t('buttons.signIn')}
            </Button>
          )}
        />
      </FieldGroup>
    </form>
  )
}

export function PasswordResetRequestForm() {
  const auth = useAuth()
  const { t } = useTranslation('auth')
  const emailId = useId()
  const emailErrorId = useId()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const form = useForm({
    defaultValues: {
      email: '',
    },
    onSubmit: async ({ value }) => {
      setFormError(null)
      setSuccessMessage(null)

      const result = passwordResetRequestSchema.safeParse(value)
      if (!result.success) {
        setFieldErrors(toFieldErrors(result.error.issues))
        return
      }

      setFieldErrors({})

      try {
        await auth.requestPasswordReset(result.data as PasswordResetRequest)
        setSuccessMessage(t('alerts.resetRequested'))
      } catch (caughtError) {
        if (caughtError instanceof ApiRequestError) {
          setFormError(caughtError.message)
          return
        }
        setFormError(t('alerts.unexpected'))
      }
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <FieldGroup className="gap-4">
        <form.Field
          name="email"
          children={(field) => (
            <Field data-invalid={hasErrors(fieldErrors.email)}>
              <FieldLabel htmlFor={emailId}>{t('fields.email')}</FieldLabel>
              <Input
                id={emailId}
                name={field.name}
                value={field.state.value}
                type="text"
                inputMode="email"
                autoComplete="email"
                aria-invalid={hasErrors(fieldErrors.email)}
                aria-describedby={errorId(fieldErrors.email, emailErrorId)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.target.value)
                  clearFieldError('email', setFieldErrors)
                  setFormError(null)
                  setSuccessMessage(null)
                }}
              />
              <FieldError id={emailErrorId} errors={fieldErrors.email} />
            </Field>
          )}
        />

        <FormAlert message={formError} />
        <SuccessAlert message={successMessage} />

        <form.Subscribe
          selector={(state) => state.isSubmitting}
          children={(isSubmitting) => (
            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t('buttons.working') : t('buttons.sendResetLink')}
            </Button>
          )}
        />

        <Button asChild type="button" variant="link" className="h-auto w-fit px-0">
          <Link to="/">{t('buttons.backToLogin')}</Link>
        </Button>
      </FieldGroup>
    </form>
  )
}

export function PasswordResetConfirmForm({ token }: { token: string }) {
  const auth = useAuth()
  const { t } = useTranslation('auth')
  const passwordId = useId()
  const passwordErrorId = useId()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const form = useForm({
    defaultValues: {
      token,
      password: '',
    },
    onSubmit: async ({ value }) => {
      setFormError(null)
      setSuccessMessage(null)

      const result = passwordResetConfirmSchema.safeParse(value)
      if (!result.success) {
        setFieldErrors(toFieldErrors(result.error.issues))
        return
      }

      setFieldErrors({})

      try {
        await auth.resetPassword(result.data as PasswordResetConfirmRequest)
        setSuccessMessage(t('alerts.passwordResetDone'))
      } catch (caughtError) {
        if (caughtError instanceof ApiRequestError) {
          setFormError(caughtError.message)
          return
        }
        setFormError(t('alerts.unexpected'))
      }
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <FieldGroup className="gap-4">
        <form.Field
          name="password"
          children={(field) => (
            <Field data-invalid={hasErrors(fieldErrors.password)}>
              <FieldLabel htmlFor={passwordId}>{t('fields.newPassword')}</FieldLabel>
              <Input
                id={passwordId}
                name={field.name}
                value={field.state.value}
                type="password"
                autoComplete="new-password"
                aria-invalid={hasErrors(fieldErrors.password)}
                aria-describedby={errorId(fieldErrors.password, passwordErrorId)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.target.value)
                  clearFieldError('password', setFieldErrors)
                  setFormError(null)
                  setSuccessMessage(null)
                }}
              />
              <FieldError id={passwordErrorId} errors={fieldErrors.password} />
            </Field>
          )}
        />

        <FormAlert message={fieldErrors.token?.[0]?.message ?? formError} />
        <SuccessAlert message={successMessage} />

        <form.Subscribe
          selector={(state) => state.isSubmitting}
          children={(isSubmitting) => (
            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t('buttons.working') : t('buttons.saveNewPassword')}
            </Button>
          )}
        />

        <Button asChild type="button" variant="link" className="h-auto w-fit px-0">
          <Link to="/">{t('buttons.backToLogin')}</Link>
        </Button>
      </FieldGroup>
    </form>
  )
}

function FormAlert({ message }: { message: string | null }) {
  const { t } = useTranslation('auth')
  if (!message) return null

  return (
    <Alert variant="destructive">
      <AlertTitle>{t('alerts.failed')}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function SuccessAlert({ message }: { message: string | null }) {
  const { t } = useTranslation('auth')
  if (!message) return null

  return (
    <Alert>
      <AlertTitle>{t('alerts.success')}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function toFieldErrors(issues: z.ZodIssue[]): FieldErrors {
  return issues.reduce<FieldErrors>((errors, issue) => {
    const field = issue.path[0]
    if (!isFieldName(field)) return errors

    errors[field] = [...(errors[field] ?? []), { message: issue.message }]
    return errors
  }, {})
}

function clearFieldError(
  field: FieldName,
  setFieldErrors: (updater: (errors: FieldErrors) => FieldErrors) => void,
) {
  setFieldErrors((currentErrors) => {
    if (!currentErrors[field]?.length) return currentErrors
    const nextErrors = { ...currentErrors }
    delete nextErrors[field]
    return nextErrors
  })
}

function hasErrors(errors: FormError[] | undefined) {
  return Boolean(errors?.length)
}

function errorId(errors: FormError[] | undefined, id: string) {
  return hasErrors(errors) ? id : undefined
}

function isFieldName(field: unknown): field is FieldName {
  return field === 'displayName' || field === 'email' || field === 'password' || field === 'token'
}
