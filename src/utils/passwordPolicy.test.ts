import { describe, expect, it } from 'vitest'
import { getPasswordPolicyMessage, isPasswordPolicyOk } from './passwordPolicy'

describe('passwordPolicy', () => {
  it('rejects short passwords', () => {
    expect(getPasswordPolicyMessage('short')).toBe('密码至少 8 位')
    expect(isPasswordPolicyOk('short')).toBe(false)
  })

  it('rejects 12345678 as a known weak password', () => {
    expect(getPasswordPolicyMessage('12345678')).toBe('密码过于简单或常见，请更换为更复杂的密码')
    expect(isPasswordPolicyOk('12345678')).toBe(false)
  })

  it('rejects other sequential digit strings', () => {
    expect(getPasswordPolicyMessage('23456789')).toBe('密码不能为连续数字')
    expect(isPasswordPolicyOk('23456789')).toBe(false)
  })

  it('allows sufficiently random 8+ char passwords', () => {
    expect(getPasswordPolicyMessage('xK9#mP2q')).toBeNull()
    expect(isPasswordPolicyOk('xK9#mP2q')).toBe(true)
  })
})
