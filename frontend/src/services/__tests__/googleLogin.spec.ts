import { describe, expect, it } from 'vitest'

import { googleLoginUrl } from '../googleLogin'

describe('googleLoginUrl', () => {
  it('is the plain login URL without a return path', () => {
    expect(googleLoginUrl()).toBe('/api/v1/auth/google/login')
  })

  it('passes the return path on, encoded', () => {
    expect(googleLoginUrl('/lists/7?sort=name')).toBe(
      '/api/v1/auth/google/login?next=%2Flists%2F7%3Fsort%3Dname',
    )
  })
})
