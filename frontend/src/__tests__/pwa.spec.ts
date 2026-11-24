import { describe, expect, it } from 'vitest'

import { API_NAVIGATE_DENYLIST, pwaOptions } from '../../pwa.config'

describe('PWA configuration', () => {
  it('uses generateSW with autoUpdate and stays disabled in dev', () => {
    expect(pwaOptions.strategies).toBe('generateSW')
    expect(pwaOptions.registerType).toBe('autoUpdate')
    expect(pwaOptions.devOptions?.enabled).toBe(false)
  })

  it('defines the web app manifest with design colors and required icons', () => {
    const manifest = pwaOptions.manifest
    expect(manifest).toBeTruthy()
    if (!manifest || typeof manifest === 'boolean') return

    expect(manifest.name).toBe('Tuolino')
    expect(manifest.short_name).toBe('Tuolino')
    expect(manifest.lang).toBe('de')
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')
    expect(manifest.theme_color).toBe('#1F7A3A')
    expect(manifest.background_color).toBe('#E4F2FC')

    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: '192x192', type: 'image/png', purpose: 'any' }),
        expect.objectContaining({ sizes: '512x512', type: 'image/png', purpose: 'any' }),
        expect.objectContaining({ sizes: '512x512', type: 'image/png', purpose: 'maskable' }),
      ]),
    )
  })

  it('excludes /api navigations from the SPA fallback and defines no runtime cache', () => {
    expect(pwaOptions.workbox?.navigateFallback).toBe('/index.html')
    expect(pwaOptions.workbox?.runtimeCaching).toEqual([])

    const denylist = pwaOptions.workbox?.navigateFallbackDenylist ?? []
    expect(denylist).toContain(API_NAVIGATE_DENYLIST)

    const isDenied = (path: string) => denylist.some((pattern) => pattern.test(path))

    expect(isDenied('/api')).toBe(true)
    expect(isDenied('/api/')).toBe(true)
    expect(isDenied('/api?foo=bar')).toBe(true)
    expect(isDenied('/api/v1/auth/google/login')).toBe(true)
    expect(isDenied('/api/v1/auth/google/callback?code=123')).toBe(true)
    expect(isDenied('/api/v1/ws')).toBe(true)

    expect(isDenied('/')).toBe(false)
    expect(isDenied('/login')).toBe(false)
    expect(isDenied('/groups/123/lists/456')).toBe(false)
    expect(isDenied('/invite/abc')).toBe(false)
    expect(isDenied('/apricot')).toBe(false)
  })
})
