/**
 * Horizon 5 — Learning Management System (LMS) page.
 *
 * Tabs: Courses | Learning Paths | My Learning | Assign (HR)
 * Route: /learning
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type {
  LearningCourse,
  LearningAssignment,
  LearningAssignmentStatus,
} from '@web-app-demo/contracts'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiRequestError } from '@/lib/api'
import { useAuth } from '@/lib/use-auth'

// ─── Root ─────────────────────────────────────────────────────────────────────

export function LearningPage() {
  const { user } = useAuth()
  const { t } = useTranslation('learning')

  if (!user) {
    return (
      <section className="mx-auto grid w-full max-w-6xl gap-3 px-5 py-12">
        <h1>{t('title')}</h1>
        <p>{t('signInPrompt')}</p>
      </section>
    )
  }

  return <LearningContent />
}

// ─── Main content ─────────────────────────────────────────────────────────────

function LearningContent() {
  const { t } = useTranslation('learning')
  const [tab, setTab] = useState('courses')

  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-12">
      <h1 className="mb-6 text-2xl font-semibold">{t('title')}</h1>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="courses">{t('tabs.courses')}</TabsTrigger>
          <TabsTrigger value="paths">{t('tabs.paths')}</TabsTrigger>
          <TabsTrigger value="myLearning">{t('tabs.myLearning')}</TabsTrigger>
          <TabsTrigger value="assign">{t('tabs.assign')}</TabsTrigger>
        </TabsList>

        <TabsContent value="courses" className="mt-6">
          <CoursesTab />
        </TabsContent>
        <TabsContent value="paths" className="mt-6">
          <PathsTab />
        </TabsContent>
        <TabsContent value="myLearning" className="mt-6">
          <MyLearningTab />
        </TabsContent>
        <TabsContent value="assign" className="mt-6">
          <AssignTab />
        </TabsContent>
      </Tabs>
    </section>
  )
}

// ─── Courses Tab ──────────────────────────────────────────────────────────────

function CoursesTab() {
  const { api } = useAuth()
  const { t } = useTranslation('learning')
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    title: '',
    description: '',
    contentType: 'article' as LearningCourse['contentType'],
    contentUrl: '',
    durationMinutes: '',
    isMandatory: false,
  })

  const query = useQuery({
    queryKey: ['learning', 'courses'],
    queryFn: () => api.listCourses(),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.createCourse({
        title: createForm.title,
        description: createForm.description || undefined,
        contentType: createForm.contentType,
        contentUrl: createForm.contentUrl || undefined,
        durationMinutes: createForm.durationMinutes
          ? Number(createForm.durationMinutes)
          : undefined,
        isMandatory: createForm.isMandatory,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['learning', 'courses'] })
      setCreateOpen(false)
      setCreateForm({
        title: '',
        description: '',
        contentType: 'article',
        contentUrl: '',
        durationMinutes: '',
        isMandatory: false,
      })
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteCourse(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['learning', 'courses'] })
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const courses = query.data?.items ?? []

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t('courses.title')}</h2>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">{t('courses.create')}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('courses.create')}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <label className="grid gap-1 text-sm">
                {t('courses.fields.title')}
                <Input
                  value={createForm.title}
                  onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t('courses.fields.contentType')}
                <select
                  className="rounded border px-2 py-1 text-sm"
                  value={createForm.contentType}
                  onChange={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      contentType: e.target.value as LearningCourse['contentType'],
                    }))
                  }
                >
                  {(['video', 'article', 'quiz', 'external_link', 'scorm'] as const).map((ct) => (
                    <option key={ct} value={ct}>
                      {t(`courses.contentType.${ct}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                {t('courses.fields.durationMinutes')}
                <Input
                  type="number"
                  value={createForm.durationMinutes}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, durationMinutes: e.target.value }))
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={createForm.isMandatory}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, isMandatory: e.target.checked }))
                  }
                />
                {t('courses.fields.isMandatory')}
              </label>
              <Button
                disabled={!createForm.title || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {t('actions.save')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {query.isLoading ? (
        <p>{t('loading')}</p>
      ) : query.isError ? (
        <p style={{ color: 'crimson' }}>{t('loadFailed')}</p>
      ) : courses.length === 0 ? (
        <p>{t('courses.empty')}</p>
      ) : (
        <div className="grid gap-3">
          {courses.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              onDelete={() => deleteMutation.mutate(course.id)}
              isActioning={deleteMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

type CourseCardProps = {
  course: LearningCourse
  onDelete: () => void
  isActioning: boolean
}

function CourseCard({ course, onDelete, isActioning }: CourseCardProps) {
  const { t } = useTranslation('learning')

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{course.title}</CardTitle>
            {course.description && (
              <p className="mt-1 text-sm text-muted-foreground">{course.description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline">{t(`courses.contentType.${course.contentType}`)}</Badge>
            {course.isMandatory && (
              <Badge variant="destructive">{t('courses.mandatory')}</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {course.durationMinutes != null &&
              t('courses.duration', { minutes: course.durationMinutes })}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={isActioning}
            onClick={onDelete}
          >
            {t('actions.delete')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Paths Tab ────────────────────────────────────────────────────────────────

function PathsTab() {
  const { api } = useAuth()
  const { t } = useTranslation('learning')
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    title: '',
    description: '',
    roleFamily: '',
    autoAssign: false,
  })

  const query = useQuery({
    queryKey: ['learning', 'paths'],
    queryFn: () => api.listPaths(),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.createPath({
        title: createForm.title,
        description: createForm.description || undefined,
        roleFamily: createForm.roleFamily || undefined,
        autoAssign: createForm.autoAssign,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['learning', 'paths'] })
      setCreateOpen(false)
      setCreateForm({ title: '', description: '', roleFamily: '', autoAssign: false })
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deletePath(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['learning', 'paths'] })
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const paths = query.data?.items ?? []

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{t('paths.title')}</h2>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">{t('paths.create')}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('paths.create')}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <label className="grid gap-1 text-sm">
                {t('paths.fields.title')}
                <Input
                  value={createForm.title}
                  onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))}
                />
              </label>
              <label className="grid gap-1 text-sm">
                {t('paths.fields.roleFamily')}
                <Input
                  value={createForm.roleFamily}
                  onChange={(e) => setCreateForm((f) => ({ ...f, roleFamily: e.target.value }))}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={createForm.autoAssign}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, autoAssign: e.target.checked }))
                  }
                />
                {t('paths.fields.autoAssign')}
              </label>
              <Button
                disabled={!createForm.title || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {t('actions.save')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {query.isLoading ? (
        <p>{t('loading')}</p>
      ) : query.isError ? (
        <p style={{ color: 'crimson' }}>{t('loadFailed')}</p>
      ) : paths.length === 0 ? (
        <p>{t('paths.empty')}</p>
      ) : (
        <div className="grid gap-3">
          {paths.map((path) => (
            <Card key={path.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{path.title}</CardTitle>
                    {path.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{path.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {path.autoAssign && (
                      <Badge variant="secondary">{t('paths.autoAssign')}</Badge>
                    )}
                    {path.roleFamily && (
                      <Badge variant="outline">{path.roleFamily}</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(path.id)}
                  >
                    {t('actions.delete')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── My Learning Tab ──────────────────────────────────────────────────────────

function MyLearningTab() {
  const { api } = useAuth()
  const { t } = useTranslation('learning')
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['learning', 'assignments', 'me'],
    queryFn: () => api.listMyAssignments(),
  })

  const updateMutation = useMutation({
    mutationFn: ({
      employeeId,
      id,
      status,
      progressPercent,
    }: {
      employeeId: string
      id: string
      status?: LearningAssignmentStatus
      progressPercent?: number
    }) => api.updateAssignment(employeeId, id, { status, progressPercent }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['learning', 'assignments'] })
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const assignments = query.data?.items ?? []

  return (
    <div className="grid gap-4">
      <h2 className="text-lg font-medium">{t('myLearning.title')}</h2>

      {query.isLoading ? (
        <p>{t('loading')}</p>
      ) : query.isError ? (
        <p style={{ color: 'crimson' }}>{t('loadFailed')}</p>
      ) : assignments.length === 0 ? (
        <p>{t('myLearning.empty')}</p>
      ) : (
        <div className="grid gap-3">
          {assignments.map((assignment) => (
            <AssignmentCard
              key={assignment.id}
              assignment={assignment}
              onStart={() =>
                updateMutation.mutate({
                  employeeId: assignment.employeeId,
                  id: assignment.id,
                  status: 'started',
                  progressPercent: Math.max(assignment.progressPercent, 10),
                })
              }
              onComplete={() =>
                updateMutation.mutate({
                  employeeId: assignment.employeeId,
                  id: assignment.id,
                  status: 'completed',
                  progressPercent: 100,
                })
              }
              isActioning={updateMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

type AssignmentCardProps = {
  assignment: LearningAssignment
  onStart: () => void
  onComplete: () => void
  isActioning: boolean
}

function AssignmentCard({ assignment, onStart, onComplete, isActioning }: AssignmentCardProps) {
  const { t } = useTranslation('learning')

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              {assignment.courseId
                ? t('myLearning.course')
                : t('myLearning.path')}
              {': '}
              {assignment.courseId ?? assignment.pathId}
            </CardTitle>
            {assignment.dueDate && (
              <p className="mt-1 text-sm text-muted-foreground">
                {t('myLearning.dueDate', {
                  date: new Date(assignment.dueDate).toLocaleDateString(),
                })}
              </p>
            )}
          </div>
          <AssignmentStatusBadge status={assignment.status} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center justify-between text-sm">
              <span>{t('myLearning.progress', { percent: assignment.progressPercent })}</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${assignment.progressPercent}%` }}
              />
            </div>
          </div>
          <div className="flex gap-2">
            {assignment.status === 'assigned' && (
              <Button size="sm" variant="outline" disabled={isActioning} onClick={onStart}>
                {t('myLearning.start')}
              </Button>
            )}
            {assignment.status === 'started' && (
              <Button size="sm" disabled={isActioning} onClick={onComplete}>
                {t('myLearning.complete')}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function AssignmentStatusBadge({ status }: { status: LearningAssignmentStatus }) {
  const { t } = useTranslation('learning')
  const variant =
    status === 'completed'
      ? 'default'
      : status === 'expired'
        ? 'destructive'
        : 'secondary'

  return <Badge variant={variant}>{t(`myLearning.status.${status}`)}</Badge>
}

// ─── Assign Tab ───────────────────────────────────────────────────────────────

function AssignTab() {
  const { api } = useAuth()
  const { t } = useTranslation('learning')
  const queryClient = useQueryClient()
  const [assignType, setAssignType] = useState<'course' | 'path'>('course')
  const [form, setForm] = useState({
    employeeId: '',
    courseId: '',
    pathId: '',
    dueDate: '',
  })

  const coursesQuery = useQuery({
    queryKey: ['learning', 'courses'],
    queryFn: () => api.listCourses(),
  })

  const pathsQuery = useQuery({
    queryKey: ['learning', 'paths'],
    queryFn: () => api.listPaths(),
  })

  const assignMutation = useMutation({
    mutationFn: () =>
      api.createAssignment(form.employeeId, {
        courseId: assignType === 'course' ? form.courseId : undefined,
        pathId: assignType === 'path' ? form.pathId : undefined,
        dueDate: form.dueDate || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['learning', 'assignments'] })
      toast.success(t('assign.success'))
      setForm({ employeeId: '', courseId: '', pathId: '', dueDate: '' })
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : t('loadFailed')),
  })

  const courses = coursesQuery.data?.items ?? []
  const paths = pathsQuery.data?.items ?? []

  const canSubmit =
    form.employeeId.length > 0 &&
    (assignType === 'course' ? form.courseId.length > 0 : form.pathId.length > 0) &&
    !assignMutation.isPending

  return (
    <div className="grid max-w-lg gap-4">
      <h2 className="text-lg font-medium">{t('assign.title')}</h2>

      <div className="grid gap-3">
        <label className="grid gap-1 text-sm">
          {t('assign.fields.employeeId')}
          <Input
            value={form.employeeId}
            onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
          />
        </label>

        <label className="grid gap-1 text-sm">
          {t('assign.fields.type')}
          <select
            className="rounded border px-2 py-1 text-sm"
            value={assignType}
            onChange={(e) => setAssignType(e.target.value as 'course' | 'path')}
          >
            <option value="course">{t('assign.type.course')}</option>
            <option value="path">{t('assign.type.path')}</option>
          </select>
        </label>

        {assignType === 'course' ? (
          <label className="grid gap-1 text-sm">
            {t('assign.fields.courseId')}
            <select
              className="rounded border px-2 py-1 text-sm"
              value={form.courseId}
              onChange={(e) => setForm((f) => ({ ...f, courseId: e.target.value }))}
            >
              <option value="">—</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="grid gap-1 text-sm">
            {t('assign.fields.pathId')}
            <select
              className="rounded border px-2 py-1 text-sm"
              value={form.pathId}
              onChange={(e) => setForm((f) => ({ ...f, pathId: e.target.value }))}
            >
              <option value="">—</option>
              {paths.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="grid gap-1 text-sm">
          {t('assign.fields.dueDate')}
          <Input
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
          />
        </label>

        <Button disabled={!canSubmit} onClick={() => assignMutation.mutate()}>
          {t('actions.assign')}
        </Button>
      </div>
    </div>
  )
}

