import { describe, expect, it } from 'vitest'

import { loginNext, loginRoute } from '../loginQuery'
import { safeNextPath } from '../nextPath'

describe('safeNextPath', () => {
  it.each(['/', '/invite/abc_-123', '/lists/7?sort=name#top', '/ä/ö', '/a%2F%2Fb'])(
    'lets the path %s pass',
    (path) => {
      expect(safeNextPath(path)).toBe(path)
    },
  )

  // The same cases as nextpath_test.go in the backend.
  it.each([
    '',
    'invite/abc',
    '//evil.example',
    '/\\evil.example',
    '/a\\b',
    '/\t/evil.example',
    '/a\nb',
    '/a\u007fb',
    'https://evil.example/',
    'javascript:alert(1)',
    `/${'a'.repeat(512)}`,
    `/${'ä'.repeat(256)}`,
    '/\ud800',
  ])('rejects %j', (path) => {
    expect(safeNextPath(path)).toBeNull()
  })

  it('rejects what is no string', () => {
    expect(safeNextPath(undefined)).toBeNull()
    expect(safeNextPath(null)).toBeNull()
    expect(safeNextPath(['/a', '/b'])).toBeNull()
  })
})

describe('loginRoute', () => {
  it('carries the reason and the path to continue on', () => {
    expect(loginRoute(true, '/invite/abc')).toEqual({
      name: 'login',
      query: { reason: 'session_expired', next: '/invite/abc' },
    })
  })

  it('leaves out the start page and unsafe paths', () => {
    expect(loginRoute(false, '/')).toEqual({ name: 'login', query: {} })
    expect(loginRoute(false, '//evil.example')).toEqual({ name: 'login', query: {} })
    expect(loginRoute(false)).toEqual({ name: 'login', query: {} })
  })
})

describe('loginNext', () => {
  it('reads a safe path from the query', () => {
    expect(loginNext({ next: '/invite/abc' })).toBe('/invite/abc')
  })

  it('is null without a path or with an unsafe one', () => {
    expect(loginNext({})).toBeNull()
    expect(loginNext({ next: '//evil.example' })).toBeNull()
    expect(loginNext({ next: ['/a', '/b'] })).toBeNull()
  })
})
