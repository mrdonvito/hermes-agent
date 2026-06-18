import { useStore } from '@nanostores/react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useElapsedSeconds } from '@/components/chat/activity-timer'
import { ActivityTimerText } from '@/components/chat/activity-timer-text'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { FadeText } from '@/components/ui/fade-text'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { type Translations, useI18n } from '@/i18n'
import { AlertCircle, CheckCircle2, Sparkles } from '@/lib/icons'
import { useEnterAnimation } from '@/lib/use-enter-animation'
import { cn } from '@/lib/utils'
import { $activeSessionId } from '@/store/session'
import {
  $subagentsBySession,
  buildSubagentTree,
  type SubagentNode,
  type SubagentProgress,
  type SubagentStatus,
  type SubagentStreamEntry,
  upsertSubagent
} from '@/store/subagents'

import { OverlayView } from '../overlays/overlay-view'

// Mirrors statusGlyph() in tool-fallback.tsx so subagent rows speak the
// same visual vocabulary as the chat tool blocks.
function statusGlyph(status: SubagentStatus, a: Translations['agents']): ReactNode {
  if (status === 'running' || status === 'queued') {
    return (
      <GlyphSpinner
        ariaLabel={a.running}
        className="size-3.5 shrink-0 text-[0.95rem] text-muted-foreground/80"
        spinner="breathe"
      />
    )
  }

  if (status === 'failed' || status === 'interrupted') {
    return <AlertCircle aria-label={a.failed} className="size-3.5 shrink-0 text-destructive" />
  }

  return <CheckCircle2 aria-label={a.done} className="size-3.5 shrink-0 text-emerald-600/85 dark:text-emerald-400/85" />
}

const STREAM_TONE: Record<SubagentStreamEntry['kind'], string> = {
  progress: 'text-muted-foreground/75',
  summary: 'text-foreground/85',
  thinking: 'text-muted-foreground/80',
  tool: 'text-foreground/85'
}

function streamGlyph(entry: SubagentStreamEntry): ReactNode {
  if (entry.isError) {
    return <AlertCircle aria-hidden className="mt-0.5 size-3 shrink-0 text-destructive" />
  }

  if (entry.kind === 'tool') {
    return <span aria-hidden className="mt-0.5 size-1.5 shrink-0 rounded-full bg-foreground/55" />
  }

  if (entry.kind === 'summary') {
    return <CheckCircle2 aria-hidden className="mt-0.5 size-3 shrink-0 text-emerald-600/85 dark:text-emerald-400/85" />
  }

  if (entry.kind === 'thinking') {
    return (
      <span aria-hidden className="font-mono text-[0.7rem] leading-none text-muted-foreground/70">
        …
      </span>
    )
  }

  return <span aria-hidden className="mt-0.5 size-1 shrink-0 rounded-full bg-muted-foreground/55" />
}

interface AgentsViewProps {
  onClose: () => void
}

interface SessionDelegationSummary {
  active: number
  failed: number
  id: string
  items: SubagentProgress[]
  latest: number
  total: number
}

const isActiveStatus = (status: SubagentStatus) => status === 'running' || status === 'queued'
const isFailedStatus = (status: SubagentStatus) => status === 'failed' || status === 'interrupted'

function summarizeSession(id: string, items: SubagentProgress[]): SessionDelegationSummary {
  return {
    active: items.filter(item => isActiveStatus(item.status)).length,
    failed: items.filter(item => isFailedStatus(item.status)).length,
    id,
    items,
    latest: items.reduce((max, item) => Math.max(max, item.updatedAt), 0),
    total: items.length
  }
}

function seedSampleDelegation() {
  const sid = `sample-delegation-${Date.now().toString(36)}`

  upsertSubagent(sid, {
    child_session_id: `${sid}-research`,
    goal: 'Research implementation options for the requested feature',
    model: 'nova · gpt-5.5',
    output_tail: [{ preview: 'Checked existing routes and component boundaries.' }],
    status: 'completed',
    subagent_id: `${sid}:research`,
    summary: 'Found the safest vertical slice and integration points.',
    task_count: 3,
    task_index: 0,
    tool_count: 4
  }, true, 'subagent.stop')
  upsertSubagent(sid, {
    child_session_id: `${sid}-build`,
    files_written: ['apps/desktop/src/app/agents/index.tsx'],
    goal: 'Build the dashboard shell and session rollups',
    model: 'gina · gpt-5.3-codex',
    output_tail: [{ preview: 'Rendering global delegation metrics and worker groups.' }],
    status: 'running',
    subagent_id: `${sid}:build`,
    task_count: 3,
    task_index: 1,
    tool_count: 7
  }, true, 'subagent.progress')
  upsertSubagent(sid, {
    child_session_id: `${sid}-qa`,
    goal: 'Smoke test dashboard states and failure visibility',
    model: 'crosby · gpt-5.5',
    output_tail: [{ is_error: true, preview: 'Waiting on Mac dev app smoke test.' }],
    status: 'failed',
    subagent_id: `${sid}:qa`,
    summary: 'QA is blocked until the Mac dev app is available.',
    task_count: 3,
    task_index: 2,
    tool_count: 2
  }, true, 'subagent.stop')

  return sid
}

export function AgentsView({ onClose }: AgentsViewProps) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const activeSessionId = useStore($activeSessionId)
  const subagentsBySession = useStore($subagentsBySession)
  const [selectedSessionId, setSelectedSessionId] = useState<null | string>(null)

  const sessions = useMemo(
    () =>
      Object.entries(subagentsBySession)
        .filter(([, items]) => items.length > 0)
        .map(([id, items]) => summarizeSession(id, items))
        .sort((a, b) => Number(b.active > 0) - Number(a.active > 0) || b.latest - a.latest || a.id.localeCompare(b.id)),
    [subagentsBySession]
  )

  useEffect(() => {
    if (activeSessionId && subagentsBySession[activeSessionId]?.length) {
      setSelectedSessionId(current => current ?? activeSessionId)
    }
  }, [activeSessionId, subagentsBySession])

  useEffect(() => {
    if (selectedSessionId && subagentsBySession[selectedSessionId]?.length) {
      return
    }

    setSelectedSessionId(sessions[0]?.id ?? null)
  }, [selectedSessionId, sessions, subagentsBySession])

  const selected = useMemo(
    () => sessions.find(session => session.id === selectedSessionId) ?? sessions[0] ?? null,
    [selectedSessionId, sessions]
  )

  const tree = useMemo(() => buildSubagentTree(selected?.items ?? []), [selected])
  const allItems = sessions.flatMap(session => session.items)
  const allAgents = allItems.length
  const activeAgents = allItems.filter(item => isActiveStatus(item.status)).length
  const failedAgents = allItems.filter(item => isFailedStatus(item.status)).length
  const completedAgents = allItems.filter(item => item.status === 'completed').length
  const selectedIsSample = selected?.id.startsWith('sample-delegation-') ?? false

  const createSample = useCallback(() => {
    setSelectedSessionId(seedSampleDelegation())
  }, [])

  const openSelectedSession = useCallback(() => {
    if (!selected) {
      return
    }

    navigate(`/${encodeURIComponent(selected.id)}`)
  }, [navigate, selected])

  return (
    <OverlayView
      closeLabel={t.agents.close}
      contentClassName="px-5 pt-5 pb-4 sm:px-6"
      onClose={onClose}
      rootClassName="mx-auto max-w-6xl"
    >
      <header className="mb-4 flex shrink-0 items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Multi-agent delegation dashboard</h2>
          <p className="text-xs text-muted-foreground/80">Watch delegated workers across sessions, spot failures, and jump back into the parent thread.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={createSample} size="sm" variant="outline">
            <Codicon className="mr-2 size-4" name="add" />
            Create sample delegation
          </Button>
          {selected && !selectedIsSample ? (
            <Button onClick={openSelectedSession} size="sm" variant="outline">
              <Codicon className="mr-2 size-4" name="go-to-file" />
              Open session
            </Button>
          ) : null}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,0.34fr)_minmax(0,1fr)] gap-4 overflow-hidden">
        <aside className="flex min-h-0 flex-col gap-3 overflow-hidden rounded-lg border bg-card/40 p-3">
          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="Agents" value={allAgents} />
            <MetricCard label="Running" tone="text-primary" value={activeAgents} />
            <MetricCard label="Done" tone="text-emerald-600 dark:text-emerald-400" value={completedAgents} />
            <MetricCard label="Needs review" tone="text-destructive" value={failedAgents} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {sessions.length === 0 ? (
              <div className="grid min-h-52 place-items-center gap-3 px-3 text-center text-muted-foreground/75">
                <div className="space-y-2">
                  <Sparkles className="mx-auto size-6 text-muted-foreground/60" />
                  <p className="text-sm font-medium text-foreground/90">No delegated agents yet</p>
                  <p className="text-xs leading-relaxed">Run a delegated task or create a local sample to verify the dashboard wiring.</p>
                </div>
              </div>
            ) : (
              <div className="grid gap-1">
                {sessions.map(session => (
                  <button
                    className={cn(
                      'grid gap-1 rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted/60',
                      selected?.id === session.id && 'bg-muted text-foreground'
                    )}
                    key={session.id}
                    onClick={() => setSelectedSessionId(session.id)}
                    type="button"
                  >
                    <span className="truncate font-medium">{session.id}</span>
                    <span className="flex flex-wrap gap-2 text-[0.68rem] text-muted-foreground/75">
                      <span>{session.total} workers</span>
                      {session.active ? <span className="text-primary">{session.active} running</span> : null}
                      {session.failed ? <span className="text-destructive">{session.failed} failed</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className="min-h-0 overflow-hidden rounded-lg border bg-card/40 p-4">
          {selected ? (
            <div className="flex h-full min-h-0 flex-col gap-3">
              <div className="shrink-0 border-b pb-3">
                <p className="truncate text-xs font-medium text-muted-foreground">Selected session</p>
                <p className="truncate text-sm font-semibold text-foreground">{selected.id}</p>
              </div>
              <SubagentTree tree={tree} />
            </div>
          ) : (
            <SubagentTree tree={[]} />
          )}
        </section>
      </div>
    </OverlayView>
  )
}

function MetricCard({ label, tone, value }: { label: string; tone?: string; value: number }) {
  return (
    <div className="rounded-md border bg-background/60 p-2">
      <div className={cn('text-lg font-semibold leading-none', tone)}>{value}</div>
      <div className="mt-1 text-[0.65rem] uppercase tracking-wide text-muted-foreground/70">{label}</div>
    </div>
  )
}

const fmtDuration = (seconds: number | undefined, a: Translations['agents']) => {
  if (!seconds || seconds <= 0) {
    return ''
  }

  if (seconds < 60) {
    return a.durationSeconds(seconds.toFixed(1))
  }

  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)

  return a.durationMinutes(m, s)
}

const fmtTokens = (value: number | undefined, a: Translations['agents']) => {
  if (!value) {
    return ''
  }

  return value >= 1000 ? a.tokensK((value / 1000).toFixed(1)) : a.tokens(value)
}

const fmtAge = (updatedAt: number, nowMs: number, a: Translations['agents']) => {
  const s = Math.max(0, Math.round((nowMs - updatedAt) / 1000))

  if (s < 2) {
    return a.ageNow
  }

  if (s < 60) {
    return a.ageSeconds(s)
  }

  const m = Math.floor(s / 60)

  if (m < 60) {
    return a.ageMinutes(m)
  }

  return a.ageHours(Math.floor(m / 60))
}

const flatten = (nodes: readonly SubagentNode[]): SubagentNode[] =>
  nodes.flatMap(node => [node, ...flatten(node.children)])

interface RootGroup {
  id: string
  delegationIndex: number
  nodes: SubagentNode[]
  taskCount: number
}

function groupDelegations(roots: readonly SubagentNode[]): RootGroup[] {
  const groups: RootGroup[] = []
  let n = 0

  for (const node of roots) {
    const prev = groups.at(-1)
    const prevTail = prev?.nodes.at(-1)
    const closeInTime = prevTail ? Math.abs(node.startedAt - prevTail.startedAt) <= 5_000 : false
    const sameShape = prev && node.taskCount > 1 && prev.taskCount === node.taskCount
    const uniqueStep = prev ? !prev.nodes.some(item => item.taskIndex === node.taskIndex) : false

    if (prev && sameShape && closeInTime && uniqueStep) {
      prev.nodes.push(node)

      continue
    }

    if (node.taskCount > 1) {
      n += 1
      groups.push({ id: `delegation-${n}`, delegationIndex: n, nodes: [node], taskCount: node.taskCount })

      continue
    }

    groups.push({ id: node.id, delegationIndex: 0, nodes: [node], taskCount: node.taskCount })
  }

  return groups
}

function SubagentTree({ tree }: { tree: SubagentNode[] }) {
  const { t } = useI18n()
  const flat = useMemo(() => flatten(tree), [tree])
  const groups = useMemo(() => groupDelegations(tree), [tree])
  const [nowMs, setNowMs] = useState(() => Date.now())

  const active = flat.filter(n => n.status === 'running' || n.status === 'queued').length
  const failed = flat.filter(n => n.status === 'failed' || n.status === 'interrupted').length
  const tools = flat.reduce((sum, n) => sum + (n.toolCount ?? 0), 0)
  const files = flat.reduce((sum, n) => sum + n.filesRead.length + n.filesWritten.length, 0)
  const tokens = flat.reduce((sum, n) => sum + (n.inputTokens ?? 0) + (n.outputTokens ?? 0), 0)
  const cost = flat.reduce((sum, n) => sum + (n.costUsd ?? 0), 0)

  useEffect(() => {
    if (active <= 0 || typeof window === 'undefined') {
      return
    }

    const id = window.setInterval(() => setNowMs(Date.now()), 500)

    return () => window.clearInterval(id)
  }, [active])

  if (tree.length === 0) {
    return (
      <div className="grid place-items-center gap-3 py-12 text-center">
        <Sparkles className="size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium text-foreground/90">{t.agents.emptyTitle}</p>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground/75">{t.agents.emptyDesc}</p>
      </div>
    )
  }

  const summary = [
    t.agents.agentsCount(flat.length),
    active > 0 ? t.agents.activeCount(active) : '',
    failed > 0 ? t.agents.failedCount(failed) : '',
    tools > 0 ? t.agents.toolsCount(tools) : '',
    files > 0 ? t.agents.filesCount(files) : '',
    tokens > 0 ? fmtTokens(tokens, t.agents) : '',
    cost > 0 ? `$${cost.toFixed(2)}` : ''
  ].filter(Boolean)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden">
      <p className="shrink-0 text-[0.7rem] text-muted-foreground/70">{summary.join(' · ')}</p>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
        <div className="flex min-w-0 flex-col gap-6">
          {groups.map(group => (
            <DelegationGroup group={group} key={group.id} nowMs={nowMs} />
          ))}
        </div>
      </div>
    </div>
  )
}

function DelegationGroup({ group, nowMs }: { group: RootGroup; nowMs: number }) {
  const { t } = useI18n()

  if (group.nodes.length === 1 && group.taskCount <= 1) {
    return <SubagentRow node={group.nodes[0]!} nowMs={nowMs} />
  }

  const activeWorkers = group.nodes.filter(n => n.status === 'running' || n.status === 'queued').length

  return (
    <section className="grid min-w-0 gap-3">
      <p className="text-[0.66rem] font-medium uppercase tracking-wider text-muted-foreground/70">
        {group.delegationIndex > 0 ? t.agents.delegation(group.delegationIndex) : ''}{' '}
        <span className="text-muted-foreground/50">·</span> {t.agents.workers(group.nodes.length)}
        {activeWorkers > 0 ? <span className="text-primary/85"> · {t.agents.workersActive(activeWorkers)}</span> : null}
      </p>
      <div className="grid min-w-0 gap-4">
        {group.nodes.map(node => (
          <SubagentRow key={node.id} node={node} nowMs={nowMs} />
        ))}
      </div>
    </section>
  )
}

function StreamLine({
  active,
  entry,
  parentRunning,
  rowKey
}: {
  active: boolean
  entry: SubagentStreamEntry
  parentRunning: boolean
  rowKey: string
}) {
  const { t } = useI18n()
  const enterRef = useEnterAnimation(parentRunning, `subagent-stream:${rowKey}`)
  const isMono = entry.kind === 'tool'
  const tone = entry.isError ? 'text-destructive' : STREAM_TONE[entry.kind]

  return (
    <div className="flex min-w-0 items-baseline gap-2 text-[0.72rem] leading-relaxed" ref={enterRef}>
      <span className="flex h-[0.95rem] shrink-0 items-center">{streamGlyph(entry)}</span>
      <span className={cn('min-w-0 flex-1 wrap-anywhere', tone, isMono && 'font-mono text-[0.69rem]')}>
        {entry.text}
        {active ? (
          <GlyphSpinner
            ariaLabel={t.agents.streaming}
            className="ml-1 inline-block size-2.5 align-middle text-muted-foreground/70"
            spinner="breathe"
          />
        ) : null}
      </span>
    </div>
  )
}

function SubagentRow({ node, depth = 0, nowMs }: { node: SubagentNode; depth?: number; nowMs: number }) {
  const { t } = useI18n()
  const running = node.status === 'running' || node.status === 'queued'
  const elapsed = useElapsedSeconds(running, `subagent:${node.id}`)

  const durationSeconds =
    typeof node.durationSeconds === 'number' ? Math.max(0, Math.round(node.durationSeconds)) : elapsed

  const [open, setOpen] = useState(() => running || depth < 2)
  const enterRef = useEnterAnimation(true, `subagent-row:${node.id}`)

  useEffect(() => {
    if (running) {
      setOpen(true)
    }
  }, [running])

  const visibleRows = open ? node.stream.slice(-10) : node.stream.slice(-2)
  const fileLines = [...node.filesWritten.map(p => `+ ${p}`), ...node.filesRead.map(p => `· ${p}`)]

  const subtitle = [
    node.model,
    fmtDuration(durationSeconds, t.agents),
    node.toolCount ? t.agents.toolsCount(node.toolCount) : '',
    fmtTokens((node.inputTokens ?? 0) + (node.outputTokens ?? 0), t.agents),
    t.agents.updatedAgo(fmtAge(node.updatedAt, nowMs, t.agents))
  ].filter(Boolean)

  return (
    <div className={cn('grid min-w-0 max-w-full gap-2', depth > 0 && 'pl-4')} data-slot="tool-block" ref={enterRef}>
      <button
        aria-expanded={open}
        className="group flex w-full min-w-0 items-start gap-2.5 text-left"
        onClick={() => setOpen(v => !v)}
        type="button"
      >
        <span className="mt-0.5 flex h-[1.1rem] shrink-0 items-center">{statusGlyph(node.status, t.agents)}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              'wrap-anywhere text-[0.82rem] font-medium leading-[1.1rem] text-foreground/90 transition-colors group-hover:text-foreground',
              running && 'shimmer text-foreground/65'
            )}
          >
            {node.goal}
          </span>
          {subtitle.length > 0 ? (
            <FadeText className="text-[0.66rem] leading-[1.05rem] text-muted-foreground/65">
              {subtitle.join(' · ')}
            </FadeText>
          ) : null}
        </span>
        {running ? <ActivityTimerText className="mt-1 shrink-0 text-[0.6rem]" seconds={durationSeconds} /> : null}
      </button>

      {visibleRows.length > 0 ? (
        <div className="grid min-w-0 gap-1 pl-6">
          {visibleRows.map((entry, i) => (
            <StreamLine
              active={running && i === visibleRows.length - 1}
              entry={entry}
              key={`${entry.kind}:${entry.at}:${i}`}
              parentRunning={running}
              rowKey={`${node.id}:${entry.kind}:${entry.at}`}
            />
          ))}
        </div>
      ) : null}

      {open && fileLines.length > 0 ? (
        <div className="grid min-w-0 gap-0.5 pl-6">
          <p className="text-[0.58rem] font-medium tracking-wider text-muted-foreground/60 uppercase">
            {t.agents.files}
          </p>
          {fileLines.slice(0, 8).map(line => (
            <p className="wrap-break-word font-mono text-[0.67rem] leading-relaxed text-muted-foreground/80" key={line}>
              {line}
            </p>
          ))}
          {fileLines.length > 8 ? (
            <p className="font-mono text-[0.67rem] leading-relaxed text-muted-foreground/65">
              {t.agents.moreFiles(fileLines.length - 8)}
            </p>
          ) : null}
        </div>
      ) : null}

      {node.children.length > 0 ? (
        <div className="grid min-w-0 gap-3 pl-6">
          {node.children.map(child => (
            <SubagentRow depth={depth + 1} key={child.id} node={child} nowMs={nowMs} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
