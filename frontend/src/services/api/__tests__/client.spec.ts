import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, apiGet } from '../client'

function stubFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiGet', () => {
  it('returns the parsed body and prefixes the api path', async () => {
    stubFetch(() => Promise.resolve(Response.json({ status: 'ok' })))

    await expect(apiGet('/health')).resolves.toEqual({ status: 'ok' })
    expect(fetch).toHaveBeenCalledWith('/api/v1/health')
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
