import { atom, computed } from 'nanostores'

import { $approvalRequests, type ApprovalRequest, clearApprovalRequest } from './prompts'

export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'
export type ApprovalCenterStatus = 'pending' | 'approved' | 'denied'
export type ApprovalCenterSource = 'live' | 'sample'

export interface ApprovalCenterItem {
  allowPermanent: boolean
  command: string
  description: string
  id: string
  requestedAt: number
  sessionId: null | string
  source: ApprovalCenterSource
  status: ApprovalCenterStatus
  title: string
}

interface SampleApproval extends ApprovalCenterItem {
  source: 'sample'
}

const SAMPLE_PREFIX = 'sample-approval-'

export const $sampleApprovals = atom<SampleApproval[]>([])

export function approvalKey(sessionId: null | string | undefined, index = 0): string {
  return sessionId ? `session:${sessionId}` : `global:${index}`
}

export function approvalFromRequest(request: ApprovalRequest, index = 0): ApprovalCenterItem {
  return {
    allowPermanent: request.allowPermanent !== false,
    command: request.command,
    description: request.description,
    id: approvalKey(request.sessionId, index),
    requestedAt: Date.now(),
    sessionId: request.sessionId,
    source: 'live',
    status: 'pending',
    title: request.description || 'Approve desktop action'
  }
}

export const $approvalCenterItems = computed([$approvalRequests, $sampleApprovals], (requests, samples) => {
  const live = Object.values(requests).map((request, index) => approvalFromRequest(request, index))

  return [...live, ...samples].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.requestedAt - a.requestedAt)
})

export function seedSampleApprovals(now = Date.now()): string {
  const batch = now.toString(36)

  const items: SampleApproval[] = [
    {
      allowPermanent: true,
      command: 'python3 tools/qbo_sync.py --client "Sample Client" --dry-run',
      description: 'Run a dry-run QuickBooks sync for a sample client.',
      id: `${SAMPLE_PREFIX}${batch}-qbo`,
      requestedAt: now,
      sessionId: 'sample-session-qbo',
      source: 'sample',
      status: 'pending',
      title: 'Approve sample QBO dry run'
    },
    {
      allowPermanent: false,
      command: 'gmail send --to prospect@example.com --draft draft_123',
      description: 'Send a prepared client email from the desktop app.',
      id: `${SAMPLE_PREFIX}${batch}-email`,
      requestedAt: now - 60_000,
      sessionId: 'sample-session-email',
      source: 'sample',
      status: 'pending',
      title: 'Approve sample outbound email'
    },
    {
      allowPermanent: true,
      command: 'rm -rf /tmp/hermes-sample-build-cache',
      description: 'Delete a temporary sample build cache directory.',
      id: `${SAMPLE_PREFIX}${batch}-cleanup`,
      requestedAt: now - 120_000,
      sessionId: 'sample-session-cleanup',
      source: 'sample',
      status: 'denied',
      title: 'Rejected sample cleanup command'
    }
  ]

  $sampleApprovals.set([...items, ...$sampleApprovals.get()])

  return items[0].id
}

export function resolveSampleApproval(id: string, choice: ApprovalChoice): boolean {
  let changed = false
  const status: ApprovalCenterStatus = choice === 'deny' ? 'denied' : 'approved'

  $sampleApprovals.set(
    $sampleApprovals.get().map(item => {
      if (item.id !== id || item.status !== 'pending') {
        return item
      }

      changed = true

      return { ...item, status }
    })
  )

  return changed
}

export function clearApprovalCenterSamples(): void {
  $sampleApprovals.set([])
}

export function clearLiveApproval(sessionId: null | string): void {
  clearApprovalRequest(sessionId)
}
