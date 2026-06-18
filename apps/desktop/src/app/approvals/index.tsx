import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'
import {
  $approvalCenterItems,
  type ApprovalCenterItem,
  type ApprovalChoice,
  clearApprovalCenterSamples,
  clearLiveApproval,
  resolveSampleApproval,
  seedSampleApprovals
} from '@/store/approval-center'
import { $gateway } from '@/store/gateway'
import { notify, notifyError } from '@/store/notifications'

import { OverlayView } from '../overlays/overlay-view'

interface ApprovalCenterViewProps {
  onClose: () => void
}

const CHOICES: { choice: ApprovalChoice; label: string; tone: 'danger' | 'primary' | 'secondary' }[] = [
  { choice: 'once', label: 'Approve once', tone: 'primary' },
  { choice: 'session', label: 'This session', tone: 'secondary' },
  { choice: 'always', label: 'Always allow', tone: 'secondary' },
  { choice: 'deny', label: 'Deny', tone: 'danger' }
]

const statusTone: Record<ApprovalCenterItem['status'], string> = {
  approved: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  denied: 'bg-destructive/10 text-destructive',
  pending: 'bg-primary/10 text-primary'
}

function formatWhen(value: number): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function statusLabel(status: ApprovalCenterItem['status']): string {
  if (status === 'approved') {
    return 'Approved'
  }

  if (status === 'denied') {
    return 'Denied'
  }

  return 'Pending'
}

function MetricCard({ label, tone, value }: { label: string; tone?: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card/45 px-3 py-2">
      <div className={cn('text-xl font-semibold leading-none text-foreground', tone)}>{value}</div>
      <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  )
}

function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', className)}>{children}</span>
}

export function ApprovalCenterView({ onClose }: ApprovalCenterViewProps) {
  const navigate = useNavigate()
  const gateway = useStore($gateway)
  const items = useStore($approvalCenterItems)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<null | string>(null)

  useEffect(() => {
    if (selectedId && items.some(item => item.id === selectedId)) {
      return
    }

    setSelectedId(items[0]?.id ?? null)
  }, [items, selectedId])

  const selected = useMemo(() => items.find(item => item.id === selectedId) ?? items[0] ?? null, [items, selectedId])
  const pending = items.filter(item => item.status === 'pending').length
  const approved = items.filter(item => item.status === 'approved').length
  const denied = items.filter(item => item.status === 'denied').length
  const live = items.filter(item => item.source === 'live').length

  const createSamples = useCallback(() => {
    const id = seedSampleApprovals()
    setSelectedId(id)
    notify({ message: 'Created sample approvals' })
  }, [])

  const respond = useCallback(
    async (item: ApprovalCenterItem, choice: ApprovalChoice) => {
      if (item.status !== 'pending') {
        return
      }

      if (choice === 'always' && !item.allowPermanent) {
        notifyError(new Error('This approval cannot be permanently allowed.'), 'Approval action unavailable')

        return
      }

      setSubmitting(`${item.id}:${choice}`)

      try {
        if (item.source === 'sample') {
          resolveSampleApproval(item.id, choice)
          notify({ message: choice === 'deny' ? 'Denied sample approval' : 'Approved sample approval' })

          return
        }

        if (!gateway) {
          throw new Error('Gateway is disconnected')
        }

        await gateway.request<{ resolved?: boolean }>('approval.respond', {
          choice,
          session_id: item.sessionId ?? undefined
        })
        clearLiveApproval(item.sessionId)
        notify({ message: choice === 'deny' ? 'Denied approval' : 'Approved action' })
      } catch (error) {
        notifyError(error, 'Approval action failed')
      } finally {
        setSubmitting(null)
      }
    },
    [gateway]
  )

  const openSession = useCallback(() => {
    if (!selected?.sessionId || selected.source === 'sample') {
      return
    }

    navigate(`/${encodeURIComponent(selected.sessionId)}`)
  }, [navigate, selected])

  return (
    <OverlayView contentClassName="px-5 pt-5 pb-4 sm:px-6" onClose={onClose} rootClassName="mx-auto max-w-6xl">
      <header className="mb-4 flex shrink-0 items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Approval Center</h2>
          <p className="text-xs text-muted-foreground/80">Review pending approvals before Hermes runs commands, sends messages, or touches external systems.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={createSamples} size="sm" variant="outline">
            <Codicon className="mr-2 size-4" name="add" />
            Create sample approvals
          </Button>
          {items.some(item => item.source === 'sample') && (
            <Button onClick={clearApprovalCenterSamples} size="sm" variant="ghost">
              Clear samples
            </Button>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(250px,0.36fr)_minmax(0,1fr)] gap-4">
        <aside className="flex min-h-0 flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="Pending" tone="text-primary" value={pending} />
            <MetricCard label="Approved" tone="text-emerald-600 dark:text-emerald-300" value={approved} />
            <MetricCard label="Denied" tone="text-destructive" value={denied} />
            <MetricCard label="Live" value={live} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card/40">
            {items.length === 0 ? (
              <div className="flex h-full min-h-80 flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
                <Codicon className="size-8" name="shield" />
                <div className="space-y-1">
                  <div className="text-sm font-medium text-foreground">No approvals waiting</div>
                  <div className="max-w-sm text-xs">When an agent needs permission, it will appear here without requiring you to hunt through chat.</div>
                </div>
                <Button onClick={createSamples} size="sm" variant="outline">
                  <Codicon className="mr-2 size-4" name="add" />
                  Create sample approvals
                </Button>
              </div>
            ) : (
              <div className="divide-y">
                {items.map(item => (
                  <button
                    className={cn('flex w-full flex-col gap-2 px-3 py-3 text-left transition-colors hover:bg-muted/50', selected?.id === item.id && 'bg-muted')}
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{item.title}</div>
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.description}</div>
                      </div>
                      <Pill className={statusTone[item.status]}>{statusLabel(item.status)}</Pill>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{item.source === 'live' ? 'live request' : 'sample'}</span>
                      {item.sessionId && (
                        <>
                          <span>·</span>
                          <span className="truncate">{item.sessionId}</span>
                        </>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="min-h-0 overflow-hidden rounded-lg border bg-card/40">
          {selected ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected approval</div>
                    <h3 className="mt-1 truncate text-base font-semibold">{selected.title}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatWhen(selected.requestedAt)}</span>
                      <span>·</span>
                      <span>{selected.source === 'live' ? 'Live gateway request' : 'Local smoke-test sample'}</span>
                      {selected.sessionId && (
                        <>
                          <span>·</span>
                          <span>{selected.sessionId}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Pill className={statusTone[selected.status]}>{statusLabel(selected.status)}</Pill>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <section className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why approval is needed</h4>
                  <p className="text-sm leading-relaxed text-foreground/90">{selected.description}</p>
                </section>

                <section className="mt-5 space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Command / action</h4>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-background/75 p-3 font-mono text-xs leading-relaxed text-foreground">
                    {selected.command || 'No command text was provided.'}
                  </pre>
                </section>

                <section className="mt-5 grid gap-2 rounded-lg border bg-background/55 p-3 text-xs text-muted-foreground sm:grid-cols-3">
                  <div>
                    <div className="font-semibold uppercase tracking-wide text-foreground/75">Scope</div>
                    <div className="mt-1">Approve once is safest. Session approval is temporary. Always allow persists a pattern.</div>
                  </div>
                  <div>
                    <div className="font-semibold uppercase tracking-wide text-foreground/75">External effects</div>
                    <div className="mt-1">This center is a gate before execution, not a log after the fact.</div>
                  </div>
                  <div>
                    <div className="font-semibold uppercase tracking-wide text-foreground/75">Permanent allow</div>
                    <div className="mt-1">{selected.allowPermanent ? 'Available for this request.' : 'Disabled for this request.'}</div>
                  </div>
                </section>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
                <Button disabled={!selected.sessionId || selected.source === 'sample'} onClick={openSession} size="sm" variant="ghost">
                  <Codicon className="mr-2 size-4" name="go-to-file" />
                  Open session
                </Button>
                <div className="flex flex-wrap items-center gap-2">
                  {CHOICES.filter(action => selected.allowPermanent || action.choice !== 'always').map(action => (
                    <Button
                      disabled={selected.status !== 'pending' || submitting !== null}
                      key={action.choice}
                      onClick={() => void respond(selected, action.choice)}
                      size="sm"
                      variant={action.tone === 'danger' ? 'destructive' : action.tone === 'primary' ? 'default' : 'outline'}
                    >
                      {submitting === `${selected.id}:${action.choice}` && <Codicon className="mr-2 size-4 animate-spin" name="sync" />}
                      {action.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-80 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <Codicon className="size-8" name="shield" />
              <div className="text-sm font-medium text-foreground">Approval Center is ready</div>
              <Button onClick={createSamples} size="sm" variant="outline">
                <Codicon className="mr-2 size-4" name="add" />
                Create sample approvals
              </Button>
            </div>
          )}
        </main>
      </div>
    </OverlayView>
  )
}
