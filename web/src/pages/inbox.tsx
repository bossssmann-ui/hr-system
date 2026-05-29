/**
 * Phase 1E — Candidate messenger inbox pages.
 *
 * Routes:
 *  /inbox                    — list of conversations
 *  /inbox/$conversationId    — conversation thread + composer
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import type { MessageChannel, Message, Conversation } from '@web-app-demo/contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'
import { cn } from '@/lib/utils'

const CHANNEL_COLORS: Record<MessageChannel, string> = {
  in_app: 'bg-sky-100 text-sky-800',
  email: 'bg-amber-100 text-amber-800',
  telegram: 'bg-blue-100 text-blue-800',
  hh_chat: 'bg-red-100 text-red-800',
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleString()
}

function ChannelBadge({ channel }: { channel: MessageChannel }) {
  const { t } = useTranslation('inbox')
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', CHANNEL_COLORS[channel])}>
      {t(`channels.${channel}`)}
    </span>
  )
}

function LoginRequired() {
  const { t } = useTranslation(['recruiting', 'common'])
  return (
    <section className="mx-auto grid w-full max-w-6xl gap-4 px-5 py-16">
      <Badge variant="outline" className="w-fit">{t('common.loginRequired')}</Badge>
      <Typography variant="h2">{t('common.loginRequired')}</Typography>
      <Typography tone="muted">{t('common.loginRequiredHint')}</Typography>
      <Link to="/" className="text-primary underline">{t('common:actions.goToAuth')}</Link>
    </section>
  )
}

export function InboxPage() {
  const auth = useAuth()
  if (!auth.user) return <LoginRequired />
  return <InboxList />
}

function InboxList() {
  const { api } = useAuth()
  const { t } = useTranslation('inbox')

  const query = useQuery({
    queryKey: ['conversations', 'list'],
    queryFn: () => api.listConversations(),
  })

  const conversations = query.data?.items ?? []

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-3">
          <Badge variant="outline" className="w-fit">{t('list.badge')}</Badge>
          <Typography variant="h2">{t('list.title')}</Typography>
          <Typography tone="muted">{t('list.subtitle')}</Typography>
        </div>
      </div>

      {query.isLoading && (
        <Card className="w-fit">
          <CardContent className="flex items-center gap-3 py-8">
            <Spinner aria-hidden />
            <Typography tone="muted">{t('list.loading')}</Typography>
          </CardContent>
        </Card>
      )}

      {query.isError && (
        <Alert variant="destructive" className="max-w-2xl">
          <AlertTitle>{t('list.errorTitle')}</AlertTitle>
          <AlertDescription>
            {query.error instanceof ApiRequestError ? query.error.message : t('list.unknownError')}
          </AlertDescription>
        </Alert>
      )}

      {!query.isLoading && conversations.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Typography tone="muted">{t('list.empty')}</Typography>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-2">
        {conversations.map((conv) => (
          <ConversationRow key={conv.id} conversation={conv} />
        ))}
      </div>
    </section>
  )
}

function ConversationRow({ conversation }: { conversation: Conversation }) {
  const { t } = useTranslation('inbox')
  return (
    <Link to="/inbox/$conversationId" params={{ conversationId: conversation.id }}>
      <Card className="transition-colors hover:bg-muted/50 cursor-pointer">
        <CardContent className="flex items-center justify-between gap-4 py-4">
          <div className="grid gap-1">
            <Typography variant="control" className="font-medium">
              {conversation.subject ?? t('list.conversation')}
            </Typography>
            <Typography variant="bodySm" tone="muted">
              {t('list.candidate')} {conversation.candidateId}
            </Typography>
          </div>
          <div className="flex items-center gap-3">
            {conversation.lastMessageAt && (
              <Typography variant="bodySm" tone="muted">
                {formatTime(conversation.lastMessageAt)}
              </Typography>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export function ConversationPage() {
  const auth = useAuth()
  if (!auth.user) return <LoginRequired />
  return <ConversationThread />
}

function ConversationThread() {
  const { conversationId } = useParams({ strict: false }) as { conversationId: string }
  const { api } = useAuth()
  const { t } = useTranslation('inbox')
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['conversations', conversationId],
    queryFn: () => api.getConversation(conversationId),
    refetchInterval: 15_000,
  })

  const channelStatusQuery = useQuery({
    queryKey: ['channel-status'],
    queryFn: () => api.getChannelStatus(),
  })

  const templatesQuery = useQuery({
    queryKey: ['message-templates'],
    queryFn: () => api.listMessageTemplates(),
  })

  const [selectedChannel, setSelectedChannel] = useState<MessageChannel>('in_app')
  const [body, setBody] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const enabledChannels = channelStatusQuery.data?.channels.filter((c) => c.enabled) ?? [{ channel: 'in_app', enabled: true }]
  const templates = templatesQuery.data?.items ?? []

  const sendMutation = useMutation({
    mutationFn: () => api.sendMessage(conversationId, { channel: selectedChannel, body, automated: false }),
    onSuccess: () => {
      setBody('')
      void queryClient.invalidateQueries({ queryKey: ['conversations', conversationId] })
      void queryClient.invalidateQueries({ queryKey: ['conversations', 'list'] })
      toast.success(t('thread.toasts.queued'))
    },
    onError: (err) => {
      toast.error(err instanceof ApiRequestError ? err.message : t('thread.toasts.sendFailed'))
    },
  })

  async function handleAiDraft() {
    setAiLoading(true)
    try {
      const result = await api.getAiDraft(conversationId)
      setBody(result.draft)
      toast.success(t('thread.toasts.aiReady'))
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t('thread.toasts.aiFailed'))
    } finally {
      setAiLoading(false)
    }
  }

  function applyTemplate(templateBody: string) {
    setBody(templateBody)
  }

  const messages = (query.data as { messages?: Message[] })?.messages ?? []

  if (query.isLoading) {
    return (
      <section className="mx-auto grid w-full max-w-6xl px-5 py-12">
        <Card className="w-fit">
          <CardContent className="flex items-center gap-3 py-8">
            <Spinner aria-hidden />
            <Typography tone="muted">{t('thread.loading')}</Typography>
          </CardContent>
        </Card>
      </section>
    )
  }

  if (query.isError || !query.data) {
    return (
      <section className="mx-auto grid w-full max-w-6xl px-5 py-12">
        <Alert variant="destructive" className="max-w-2xl">
          <AlertTitle>{t('thread.notFoundTitle')}</AlertTitle>
          <AlertDescription>
            {query.error instanceof ApiRequestError ? query.error.message : t('thread.notFound')}
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
      <div className="flex items-center gap-4">
        <Link to="/inbox" className="text-muted-foreground text-sm hover:underline">{t('thread.back')}</Link>
        <div className="grid gap-1">
          <Badge variant="outline" className="w-fit">{t('thread.badge')}</Badge>
          <Typography variant="h2">
            {(query.data as { subject?: string | null }).subject ?? t('list.conversation')}
          </Typography>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('thread.messagesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {messages.length === 0 && (
            <Typography tone="muted">{t('thread.noMessages')}</Typography>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('thread.composerTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Typography variant="bodySm" tone="muted">{t('thread.channel')}</Typography>
            <div className="flex flex-wrap gap-2">
              {enabledChannels.map((ch) => (
                <button
                  key={ch.channel}
                  type="button"
                  onClick={() => setSelectedChannel(ch.channel as MessageChannel)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm transition-colors',
                    selectedChannel === ch.channel
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background hover:bg-muted',
                  )}
                >
                  {t(`channels.${ch.channel as MessageChannel}`)}
                </button>
              ))}
            </div>
          </div>

          {templates.length > 0 && (
            <div className="grid gap-2">
              <Typography variant="bodySm" tone="muted">{t('thread.templates')}</Typography>
              <div className="flex flex-wrap gap-2">
                {templates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => applyTemplate(tmpl.body)}
                    className="rounded border border-border bg-background px-3 py-1 text-sm hover:bg-muted"
                  >
                    {tmpl.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[120px] resize-y"
            placeholder={t('thread.bodyPlaceholder')}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />

          <div className="flex items-center gap-3">
            <Button
              onClick={() => sendMutation.mutate()}
              disabled={!body.trim() || sendMutation.isPending}
            >
              {sendMutation.isPending ? <Spinner className="mr-2 h-4 w-4" aria-hidden /> : null}
              {t('thread.send')}
            </Button>

            <Button
              variant="outline"
              onClick={handleAiDraft}
              disabled={aiLoading}
            >
              {aiLoading ? <Spinner className="mr-2 h-4 w-4" aria-hidden /> : null}
              {t('thread.aiDraft')}
            </Button>

            <Typography variant="bodySm" tone="muted">
              {t('thread.sendingAs')} <ChannelBadge channel={selectedChannel} />
            </Typography>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isOutbound = message.direction === 'outbound'

  return (
    <div className={cn('flex gap-3', isOutbound ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className={cn(
          'max-w-[70%] rounded-lg px-4 py-3 text-sm shadow-sm',
          isOutbound
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground',
        )}
      >
        <div className="mb-1 flex items-center gap-2">
          <ChannelBadge channel={message.channel} />
          <span className="text-[10px] opacity-70">
            {formatTime(message.createdAt)}
          </span>
          <span className={cn('text-[10px] uppercase opacity-70', message.status === 'failed' && 'text-destructive font-bold')}>
            {message.status}
          </span>
        </div>
        <p className="whitespace-pre-wrap">{message.body}</p>
      </div>
    </div>
  )
}
