import { describe, expect, it } from 'vitest'

import { buildInviteLink, extractInviteToken } from '../inviteLink'

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

describe('buildInviteLink', () => {
  it('puts the token behind /invite/ on the given origin', () => {
    expect(buildInviteLink('https://mitbringsel.tinowolter.com', TOKEN)).toBe(
      `https://mitbringsel.tinowolter.com/invite/${TOKEN}`,
    )
  })

  it('is what extractInviteToken reads back', () => {
    expect(extractInviteToken(buildInviteLink('http://localhost:5173', TOKEN))).toBe(TOKEN)
  })

  it('cannot change the path with a strange token', () => {
    expect(buildInviteLink('https://example.com', 'a/b?c')).toBe(
      'https://example.com/invite/a%2Fb%3Fc',
    )
  })
})
