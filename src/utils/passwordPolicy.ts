/** 与后端弱密码/常见密码校验保持一致的客户端提示与预检（见 README 与 API 行为） */

export const PASSWORD_RULES_SHORT = '至少 8 位，且不能为常见或连续弱密码（如 12345678）'

export const PASSWORD_RULES_TOOLTIP =
  '密码须至少 8 位；不能为连续或重复数字（如 12345678、11111111）、连续字母，或常见弱密码。请使用更随机的组合。'

const COMMON_WEAK = new Set(
  [
    '12345678',
    '87654321',
    '11111111',
    '00000000',
    'password',
    'password1',
    '123456789',
    '1234567890',
    'qwerty123',
    'admin123',
  ].map((s) => s.toLowerCase()),
)

function isAllSameChar(s: string): boolean {
  if (s.length < 2) return false
  const c0 = s[0]
  for (let i = 1; i < s.length; i++) {
    if (s[i] !== c0) return false
  }
  return true
}

/** 连续升序/降序数字，如 12345678、23456789 */
function isSequentialDigits(s: string): boolean {
  if (s.length < 4 || !/^\d+$/.test(s)) return false
  let inc = true
  let dec = true
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1)
    if (d !== 1) inc = false
    if (d !== -1) dec = false
  }
  return inc || dec
}

/** 连续升序/降序 ASCII 字母，如 abcdefgh、hgfedcba */
function isSequentialLetters(s: string): boolean {
  if (s.length < 4) return false
  const lower = s.toLowerCase()
  if (!/^[a-z]+$/.test(lower)) return false
  let inc = true
  let dec = true
  for (let i = 1; i < lower.length; i++) {
    const d = lower.charCodeAt(i) - lower.charCodeAt(i - 1)
    if (d !== 1) inc = false
    if (d !== -1) dec = false
  }
  return inc || dec
}

export function getPasswordPolicyMessage(password: string): string | null {
  const p = password
  if (p.length < 8) return '密码至少 8 位'
  const lower = p.toLowerCase()
  if (COMMON_WEAK.has(lower)) return '密码过于简单或常见，请更换为更复杂的密码'
  if (isAllSameChar(p)) return '密码不能为全部相同字符'
  if (isSequentialDigits(p)) return '密码不能为连续数字'
  if (isSequentialLetters(p)) return '密码不能为连续字母'
  return null
}

export function isPasswordPolicyOk(password: string): boolean {
  return getPasswordPolicyMessage(password) === null
}
