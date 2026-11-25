/**
 * Text-only AI calls that must return JSON. Ported from Argus `_parse_json` / `_call_json`:
 * strip fences → parse → repair bare English quotes between CJK → outermost braces → one retry.
 */

const CJK = '[一-鿿，。：；、！？（）【】《》—…]'
const BARE_QUOTE = new RegExp(`(${CJK})"(${CJK})`, 'g')

export function repairJsonQuotes(text: string): string {
  return text.replace(BARE_QUOTE, '$1「$2')
}

export function parseAiJson(text: string): Record<string, unknown> | null {
  let t = (text || '').trim()
  if (t.startsWith('```'))
    t = t
      .split('\n')
      .filter((line) => !line.trim().startsWith('```'))
      .join('\n')
  const attempt = (value: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  const first = attempt(t) ?? attempt(repairJsonQuotes(t))
  if (first) return first
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  const inner = t.slice(start, end + 1)
  return attempt(inner) ?? attempt(repairJsonQuotes(inner))
}

export type AiText = (purpose: string, prompt: string, timeoutMs: number) => Promise<string>

export const JSON_RETRY_HINT =
  '\n\n注意：上一次输出不是合法 JSON。最常见原因：字符串值内部出现了未转义的英文双引号——引用词语一律改用中文引号「」。请重新输出严格合法的 JSON，不要任何解释文字。'

/** One call plus one corrective retry; throws with the start of the bad output. */
export async function callAiJson<T>(
  ai: AiText,
  purpose: string,
  prompt: string,
  validate: (value: Record<string, unknown>) => T | null,
  timeoutMs = 240_000,
): Promise<{ value: T; calls: number }> {
  let calls = 0
  let last = ''
  for (const text of [prompt, prompt + JSON_RETRY_HINT]) {
    calls++
    last = await ai(purpose, text, timeoutMs)
    const parsed = parseAiJson(last)
    const value = parsed ? validate(parsed) : null
    if (value) return { value, calls }
  }
  throw new Error(`AI 输出无法解析为约定的 JSON：${last.slice(0, 120)}`)
}
