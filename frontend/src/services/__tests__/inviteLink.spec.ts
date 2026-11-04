import { describe, expect, it } from 'vitest'

import { extractInviteToken } from '../inviteLink'

const TOKEN = 'Kx9f2mQ7vLp3Zt8RnW4cYb6HdJs1Ua5EoN0gXiT7wBq'

describe('extractInviteToken', () => {
  it.each([
    `https://mitbringsel.tinowolter.com/invite/${TOKEN}`,
    `mitbringsel.tinowolter.com/invite/${TOKEN}`,
    `/invite/${TOKEN}`,
    `  https://example.com/invite/${TOKEN}\n`,
    `https://example.com/invite/${TOKEN}/`,
    `https://example.com/invite/${TOKEN}?utm=x`,
    `https://example.com/invite/${TOKEN}#top`,
  ])('finds the token in %j', (input) => {
    expect(extractInviteToken(input)).toBe(TOKEN)
  })

  it.each([
    '',
    'hallo',
    'https://mitbringsel.tinowolter.com/rezepte/hallo',
    'https://example.com/invite/',
    'https://example.com/invite/abc',
    `https://example.com/invites/${TOKEN}`,
    `https://example.com/invite/${TOKEN}%20x`,
  ])('rejects %j', (input) => {
    expect(extractInviteToken(input)).toBeNull()
  })
})
