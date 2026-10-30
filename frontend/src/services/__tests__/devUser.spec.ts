import { describe, expect, it } from 'vitest'

import { resolveDevUser } from '../devUser'

describe('resolveDevUser', () => {
  const env = { VITE_DEV_USER_EMAIL: 'tino@example.com', VITE_DEV_USER_NAME: 'Tino' }

  it.each([
    {
      name: 'user from .env.local',
      env,
      search: '',
      want: { email: 'tino@example.com', name: 'Tino' },
    },
    {
      name: 'no name configured',
      env: { VITE_DEV_USER_EMAIL: 'tino@example.com' },
      search: '',
      want: { email: 'tino@example.com' },
    },
    {
      name: 'url parameter wins, without the env name',
      env,
      search: '?devUser=anna@example.com',
      want: { email: 'anna@example.com' },
    },
    {
      name: 'url parameter alone',
      env: {},
      search: '?devUser=anna@example.com',
      want: { email: 'anna@example.com' },
    },
    {
      name: 'url parameter with the env email keeps the name',
      env,
      search: '?devUser=tino@example.com',
      want: { email: 'tino@example.com', name: 'Tino' },
    },
    {
      name: 'whitespace is trimmed',
      env: { VITE_DEV_USER_EMAIL: ' tino@example.com ', VITE_DEV_USER_NAME: ' Tino ' },
      search: '',
      want: { email: 'tino@example.com', name: 'Tino' },
    },
    {
      name: 'empty parameter falls back to env',
      env,
      search: '?devUser=',
      want: { email: 'tino@example.com', name: 'Tino' },
    },
    { name: 'nothing configured', env: {}, search: '', want: null },
    {
      name: 'blank email counts as nothing',
      env: { VITE_DEV_USER_EMAIL: '  ' },
      search: '',
      want: null,
    },
  ])('$name', ({ env, search, want }) => {
    expect(resolveDevUser(env, search)).toEqual(want)
  })
})
