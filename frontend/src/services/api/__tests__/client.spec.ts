import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatchJson,
  apiPost,
  apiPostJson,
  apiPut,
  apiPutJson,
  setUnauthenticatedHandler,
} from '../client'

function stubFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

afterEach(() => {
  vi.unstubAllGlobals()
  setUnauthenticatedHandler(null)
})

describe('apiGet', () => {
  it('returns the parsed body and prefixes the api path', async () => {
    stubFetch(() => Promise.resolve(Response.json({ status: 'ok' })))

    await expect(apiGet('/health')).resolves.toEqual({ status: 'ok' })
    expect(fetch).toHaveBeenCalledWith('/api/v1/health', undefined)
  })

  it('maps the backend error code and status', async () => {
    stubFetch(() =>
      Promise.resolve(Response.json({ error: { code: 'DB_UNAVAILABLE' } }, { status: 503 })),
    )

    await expect(apiGet('/health')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'DB_UNAVAILABLE',
      status: 503,
    })
  })

  it('uses UNKNOWN when an error response is not in the api format', async () => {
    stubFetch(() => Promise.resolve(new Response('<html>Bad Gateway</html>', { status: 502 })))

    await expect(apiGet('/health')).rejects.toMatchObject({ code: 'UNKNOWN', status: 502 })
  })

  it('uses UNKNOWN when the error json has the wrong shape', async () => {
    stubFetch(() => Promise.resolve(Response.json({ error: 'nope' }, { status: 500 })))

    await expect(apiGet('/health')).rejects.toMatchObject({ code: 'UNKNOWN' })
  })

  it('reports NETWORK when the server cannot be reached', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))

    const err: unknown = await apiGet('/health').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ code: 'NETWORK', status: undefined })
  })
})

describe('apiPost', () => {
  it('sends the body as json', async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })))

    await expect(apiPost('/auth/dev/login', { email: 'anna@example.com' })).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith('/api/v1/auth/dev/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"email":"anna@example.com"}',
    })
  })

  it('sends no body and no content type without a body', async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })))

    await apiPost('/auth/logout')

    expect(fetch).toHaveBeenCalledWith('/api/v1/auth/logout', { method: 'POST' })
  })

  it('maps the backend error code and status', async () => {
    stubFetch(() =>
      Promise.resolve(Response.json({ error: { code: 'CROSS_ORIGIN_REQUEST' } }, { status: 403 })),
    )

    await expect(apiPost('/auth/logout')).rejects.toMatchObject({
      code: 'CROSS_ORIGIN_REQUEST',
      status: 403,
    })
  })
})

describe('apiPostJson, apiPatchJson, apiPut, apiPutJson, apiDelete', () => {
  it('apiPostJson sends the body and returns the parsed answer', async () => {
    stubFetch(() => Promise.resolve(Response.json({ id: 'g1' }, { status: 201 })))

    await expect(apiPostJson('/groups', { name: 'WG' })).resolves.toEqual({ id: 'g1' })
    expect(fetch).toHaveBeenCalledWith('/api/v1/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"WG"}',
    })
  })

  it('apiPostJson works without a body', async () => {
    stubFetch(() => Promise.resolve(Response.json({ groupId: 'g1' })))

    await expect(apiPostJson('/invites/t/accept')).resolves.toEqual({ groupId: 'g1' })
    expect(fetch).toHaveBeenCalledWith('/api/v1/invites/t/accept', { method: 'POST' })
  })

  it('apiPatchJson sends the body and returns the parsed answer', async () => {
    stubFetch(() => Promise.resolve(Response.json({ id: 'g1', name: 'Büro' })))

    await expect(apiPatchJson('/groups/g1', { name: 'Büro' })).resolves.toEqual({
      id: 'g1',
      name: 'Büro',
    })
    expect(fetch).toHaveBeenCalledWith('/api/v1/groups/g1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"Büro"}',
    })
  })

  it('apiPut sends the body and resolves without a value', async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })))

    await expect(apiPut('/groups/g1/members/u1/role', { role: 'admin' })).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith('/api/v1/groups/g1/members/u1/role', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"role":"admin"}',
    })
  })

  it('apiPutJson sends the body and returns the parsed answer', async () => {
    stubFetch(() =>
      Promise.resolve(Response.json({ id: 'l1', archivedAt: '2026-01-01T10:00:00Z' })),
    )

    await expect(apiPutJson('/lists/l1/archived', { archived: true })).resolves.toEqual({
      id: 'l1',
      archivedAt: '2026-01-01T10:00:00Z',
    })
    expect(fetch).toHaveBeenCalledWith('/api/v1/lists/l1/archived', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"archived":true}',
    })
  })

  it('apiDelete sends no body and resolves without a value', async () => {
    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })))

    await expect(apiDelete('/groups/g1')).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith('/api/v1/groups/g1', { method: 'DELETE' })
  })

  it('apiDelete maps the backend error code and status', async () => {
    stubFetch(() =>
      Promise.resolve(Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 })),
    )

    await expect(apiDelete('/groups/g1')).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
  })
})

describe('Retry-After', () => {
  function rateLimited(retryAfter: string | null) {
    stubFetch(() =>
      Promise.resolve(
        Response.json(
          { error: { code: 'RATE_LIMITED' } },
          { status: 429, headers: retryAfter === null ? {} : { 'Retry-After': retryAfter } },
        ),
      ),
    )
  }

  it('is passed on in seconds', async () => {
    rateLimited('42')

    await expect(apiGet('/invites/x')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterSeconds: 42,
    })
  })

  it.each([null, 'soon', '0', '-5', '1.5'])('is left out when it is %j', async (value) => {
    rateLimited(value)

    const err: unknown = await apiGet('/invites/x').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).retryAfterSeconds).toBeUndefined()
  })
})

describe('unauthenticated handler', () => {
  it('runs on 401 before the request rejects', async () => {
    stubFetch(() =>
      Promise.resolve(Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 })),
    )
    const handler = vi.fn()
    setUnauthenticatedHandler(handler)

    await expect(apiGet('/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it.each([200, 403, 500])('does not run on status %i', async (status) => {
    stubFetch(() => Promise.resolve(Response.json({ error: { code: 'X' } }, { status })))
    const handler = vi.fn()
    setUnauthenticatedHandler(handler)

    await apiGet('/me').catch(() => undefined)

    expect(handler).not.toHaveBeenCalled()
  })
})
