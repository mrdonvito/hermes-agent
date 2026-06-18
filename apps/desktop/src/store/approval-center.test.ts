import { beforeEach, describe, expect, it } from 'vitest'

import {
  $approvalCenterItems,
  $sampleApprovals,
  clearApprovalCenterSamples,
  resolveSampleApproval,
  seedSampleApprovals
} from './approval-center'
import { clearAllPrompts, setApprovalRequest } from './prompts'

const reset = () => {
  clearAllPrompts()
  clearApprovalCenterSamples()
}

describe('approval center store', () => {
  beforeEach(reset)

  it('combines live approval prompts with local sample approvals', () => {
    setApprovalRequest({
      allowPermanent: true,
      command: 'npm run build',
      description: 'Run desktop build',
      sessionId: 'session-1'
    })

    seedSampleApprovals(1_700_000_000_000)

    const items = $approvalCenterItems.get()

    expect(items.some(item => item.source === 'live' && item.sessionId === 'session-1')).toBe(true)
    expect(items.filter(item => item.source === 'sample')).toHaveLength(3)
  })

  it('marks sample approvals approved or denied without touching live prompts', () => {
    const id = seedSampleApprovals(1_700_000_000_000)

    expect(resolveSampleApproval(id, 'once')).toBe(true)
    expect($sampleApprovals.get().find(item => item.id === id)?.status).toBe('approved')
    expect(resolveSampleApproval(id, 'deny')).toBe(false)
  })

  it('keeps pending approvals ahead of resolved samples', () => {
    seedSampleApprovals(1_700_000_000_000)

    const statuses = $approvalCenterItems.get().map(item => item.status)

    expect(statuses.slice(0, 2)).toEqual(['pending', 'pending'])
    expect(statuses.at(-1)).toBe('denied')
  })
})
