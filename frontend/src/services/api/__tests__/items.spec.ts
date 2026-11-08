import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Item } from '@/types/api'

import { itemsService } from '../items'

function item(id: string, name: string): Item {
  return {
    id,
    listId: 'l1',
    name,
    quantity: null,
    unit: null,
    note: null,
    checked: false,
    checkedBy: null,
    checkedAt: null,
    createdBy: null,
    createdAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
    clocks: { name: 'c', quantity: 'c', unit: 'c', note: 'c', checked: 'c' },
  }
}

// A new Response per call: the body of a Response can only be read once.
function stubFetch(makeResponse: () => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(makeResponse())),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('itemsService', () => {
  it('lists the items of a list', async () => {
    stubFetch(() => Response.json({ items: [item('i1', 'Milch')] }))

    await expect(itemsService.list('l1')).resolves.toEqual([item('i1', 'Milch')])
    expect(fetch).toHaveBeenCalledWith('/api/v1/lists/l1/items', undefined)
  })

  it('creates an item in a list', async () => {
    stubFetch(() => Response.json(item('i1', 'Milch'), { status: 201 }))

    await expect(
      itemsService.create('l1', { name: 'Milch', quantity: 2, unit: 'l' }),
    ).resolves.toEqual(item('i1', 'Milch'))
    expect(fetch).toHaveBeenCalledWith('/api/v1/lists/l1/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"Milch","quantity":2,"unit":"l"}',
    })
  })

  it('sends only the fields to change, and null to remove a value', async () => {
    stubFetch(() => Response.json(item('i1', 'Milch')))

    await itemsService.update('i1', { note: null, checked: true })

    expect(fetch).toHaveBeenCalledWith('/api/v1/items/i1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"note":null,"checked":true}',
    })
  })

  it('deletes an item', async () => {
    stubFetch(() => new Response(null, { status: 204 }))

    await expect(itemsService.remove('i1')).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith('/api/v1/items/i1', { method: 'DELETE' })
  })
})
