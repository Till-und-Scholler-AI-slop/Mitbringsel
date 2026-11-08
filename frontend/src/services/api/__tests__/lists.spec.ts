import { afterEach, describe, expect, it, vi } from 'vitest'

import type { List } from '@/types/api'

import { listsService } from '../lists'

function list(id: string, name: string): List {
  return {
    id,
    groupId: 'g1',
    name,
    archivedAt: null,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
  }
}

// A new Response per call: the body of a Response can only be read once.
function stubFetch(makeResponse: () => Response) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(makeResponse())))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listsService', () => {
  it('lists the active lists of a group', async () => {
    stubFetch(() => Response.json({ lists: [list('l1', 'Supermarkt')] }))

    await expect(listsService.list('g1', { includeArchived: false })).resolves.toEqual([
      list('l1', 'Supermarkt'),
    ])
    expect(fetch).toHaveBeenCalledWith('/api/v1/groups/g1/lists', undefined)
  })

  it('asks for archived lists, too, when told to', async () => {
    stubFetch(() => Response.json({ lists: [] }))

    await listsService.list('g1', { includeArchived: true })

    expect(fetch).toHaveBeenCalledWith('/api/v1/groups/g1/lists?includeArchived=true', undefined)
  })

  it('creates a list in a group', async () => {
    stubFetch(() => Response.json(list('l1', 'Baumarkt'), { status: 201 }))

    await expect(listsService.create('g1', 'Baumarkt')).resolves.toEqual(list('l1', 'Baumarkt'))
    expect(fetch).toHaveBeenCalledWith('/api/v1/groups/g1/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"Baumarkt"}',
    })
  })

  it('renames a list', async () => {
    stubFetch(() => Response.json(list('l1', 'Drogerie')))

    await expect(listsService.rename('l1', 'Drogerie')).resolves.toEqual(list('l1', 'Drogerie'))
    expect(fetch).toHaveBeenCalledWith('/api/v1/lists/l1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"Drogerie"}',
    })
  })

  it('archives and unarchives a list', async () => {
    stubFetch(() => Response.json(list('l1', 'Supermarkt')))

    await listsService.setArchived('l1', true)
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/lists/l1/archived', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"archived":true}',
    })

    await listsService.setArchived('l1', false)
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/lists/l1/archived', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"archived":false}',
    })
  })

  it('deletes a list', async () => {
    stubFetch(() => new Response(null, { status: 204 }))

    await expect(listsService.remove('l1')).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith('/api/v1/lists/l1', { method: 'DELETE' })
  })
})
