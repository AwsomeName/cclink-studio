/**
 * delete-kill-policy — 删除/终止类操作识别（ADR 0020）
 *
 * 识别范围（可判定）：
 * - 结构化工具：KillShell、browser_clear_cookies、android_uninstall_package、cad_clear_cache。
 * - Shell 命令行文本本身：按引号感知的分段/分词，识别 rm/rmdir/unlink/shred/trash、
 *   git clean/git rm、find -delete / -exec rm、kill/pkill/killall、shutdown/reboot/halt/poweroff。
 * - 复合结构：`&&`、`||`、`;`、`|`、`&`、换行分段，任一段命中即命中；
 *   `sudo`/`env`/`nohup`/`nice` 等包装前缀与环境变量赋值前缀会被剥离；
 *   `xargs` 的命令操作数按剩余命令行递归判定。
 * - 控制结构：控制关键字按透明前缀跳过后继续判定剩余命令位（`then rm x` 与
 *   `rm x` 同判）；`for/select var in <words>` 的循环项、`case` 的主题词与
 *   分支模式（`pat)`）不是命令词，跳过。命令替换在分段前已抽出递归分析。
 * - 内联代码：`bash/sh/zsh/... -c <字面量>`（含 `bash -lc` 等合并 flag）、`node -e`、
 *   `python -c`、`osascript -e`、`eval <字面量>` 与 `$()`/反引号/进程替换内容递归分析。
 *
 * fail-closed（无法可靠判断 → 返回确认理由）：
 * - Bash 缺少 command 参数；
 * - 命令位或解释器代码位由变量动态构造（`eval "$VAR"`、`bash -c "$CMD"`）；
 * - `case` 语句找不到 `in` 关键字（退回主题词命令位分析）；
 * - 递归深度超限或 heredoc 命中删除/终止词。
 *
 * 明确不判定（放行，残余风险见 ADR 0020）：
 * - 脚本文件执行（`bash x.sh`、`node x.js`、`./x.sh`、`source x`）；
 * - 包管理器/构建工具等 runner 的内部行为（`pnpm test`、`make` 内部可能删除文件）。
 * 静态单行分析看不到文件内容与 runner 内部实现，本模块不承诺绝对保证。
 */

/** 递归分析的最大嵌套深度（解释器 -c 内再嵌 -c 等）。 */
const MAX_ANALYSIS_DEPTH = 8

/** 直接删除文件/目录的命令词。 */
const DELETE_COMMANDS = new Set(['rm', 'rmdir', 'unlink', 'shred', 'srm', 'trash'])

/** 终止进程或系统的命令词。 */
const KILL_COMMANDS = new Set([
  'kill',
  'pkill',
  'killall',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
])

/** 携带命令操作数的包装前缀；真实命令词在其后。 */
const WRAPPER_COMMANDS = new Set(['sudo', 'env', 'nohup', 'nice', 'command', 'builtin', 'time'])

/** 支持 `-c <code>` 内联代码的 shell 解释器。 */
const SHELL_INTERPRETERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'csh', 'tcsh', 'fish'])

/** 支持内联代码的其他解释器 → 对应 flag。 */
const CODE_INTERPRETER_FLAGS: Record<string, string> = {
  node: '-e',
  deno: '-e',
  python: '-c',
  python3: '-c',
  perl: '-e',
  ruby: '-e',
  osascript: '-e',
}

/** `git` 需要跳过并消费操作数的全局参数。 */
const GIT_GLOBAL_FLAG_ARGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

/**
 * 透明控制关键字：跳过后剩余 token 继续按命令位分析（`do rm x` 与 `rm x` 同判），
 * 不再对控制结构整体 fail-closed。
 */
const TRANSPARENT_CONTROL_KEYWORDS = new Set([
  'if',
  'then',
  'elif',
  'else',
  'while',
  'until',
  'do',
  'done',
  'fi',
  'esac',
  'case',
  'for',
  'select',
  'function',
])

/** 解释器携带代码参数的 flag 形态：`-c`、合并短 flag `-lc`、长 flag `--eval`。 */
function isInterpreterCodeFlag(token: string, codeFlag: string): boolean {
  if (token === codeFlag) return true
  const shortFlag = codeFlag.replace(/^-+/, '')
  if (token.startsWith('--')) return token === `--${shortFlag}` || token === '--eval'
  return token.startsWith('-') && token.length > 1 && token.includes(shortFlag)
}

interface ShellToken {
  text: string
  /** token 是否整体处于引号内（影响变量动态性判断）。 */
  quoted: boolean
}

/** 结构化工具与 SDK 工具的删除/终止类判定。 */
export function deleteKillReasonFor(
  toolName: string,
  params: Record<string, unknown> | undefined,
): string | null {
  switch (toolName) {
    case 'KillShell':
      return '终止进程类操作（KillShell）需要逐次确认'
    case 'browser_clear_cookies':
      return '删除类操作（清除 Cookie/登录数据）需要逐次确认'
    case 'android_uninstall_package':
      return '删除类操作（卸载设备应用）需要逐次确认'
    case 'cad_clear_cache':
      return '删除类操作（清理 CAD 预览缓存）需要逐次确认'
    case 'Bash': {
      const command = params?.command
      if (typeof command !== 'string' || command.trim() === '') {
        return 'Bash 调用缺少 command 参数，无法判断风险，已按需要确认处理'
      }
      return deleteKillReasonForShellCommand(command)
    }
    default:
      return null
  }
}

/** 对 shell 命令行文本做静态删除/终止类分析；返回 null 表示未命中。 */
export function deleteKillReasonForShellCommand(command: string): string | null {
  return analyzeCommandLine(command, 0)
}

function analyzeCommandLine(command: string, depth: number): string | null {
  if (depth > MAX_ANALYSIS_DEPTH) {
    return '命令嵌套过深，无法可靠判断删除/终止风险，已按需要确认处理'
  }
  // 反斜杠行续符先归一为空格。
  const normalized = command.replace(/\\\r?\n/g, ' ')
  // heredoc 内容无法结构化解析；对原始文本做保守词扫描。
  if (/<<-?\s*\S/.test(normalized) && rawScanHitsDeleteOrKill(normalized)) {
    return '命令包含 heredoc 且其中出现删除/终止类命令词，需要逐次确认'
  }
  // 先抽出命令/进程替换，替换内容递归分析，剩余部分继续结构化分析。
  const extraction = extractSubstitutions(normalized)
  for (const inner of extraction.inner) {
    const reason = analyzeCommandLine(inner, depth + 1)
    if (reason) return reason
  }
  for (const segment of splitSegments(extraction.rest)) {
    const reason = analyzeSegment(segment, depth)
    if (reason) return reason
  }
  return null
}

function analyzeSegment(segment: string, depth: number): string | null {
  const args = stripRedirections(tokenize(segment))
  let index = 0
  // 环境变量赋值前缀、子 shell 起始符、控制关键字、case 模式、包装命令前缀及其
  // flag 都跳过；剩余部分继续按普通命令位分析。
  while (index < args.length) {
    const token = args[index]
    const text = token.text
    if (text === '(' || text === '{' || isEnvironmentAssignment(text)) {
      index += 1
      continue
    }
    // case 分支模式（`pat)`）与函数定义形态（`name()`）以 `)` 结尾，不会是命令词。
    if (text.endsWith(')')) {
      index += 1
      continue
    }
    if (text.startsWith('-')) {
      index += 1
      continue
    }
    const keyword = commandBasename(text)
    if (TRANSPARENT_CONTROL_KEYWORDS.has(keyword)) {
      if (keyword === 'case') {
        // 跳过主题词到 `in`；分支模式由 `)` 后缀规则跳过。找不到 `in` 时保持
        // 主题词命令位分析（变量主题会 fail-closed）。
        let cursor = index + 1
        while (cursor < args.length && args[cursor].text !== 'in') cursor += 1
        if (cursor >= args.length) break
        index = cursor + 1
        continue
      }
      if (keyword === 'function') {
        // `function name { ... }` 的函数名不是命令词，连同关键字一起跳过。
        index = Math.min(index + 2, args.length)
        continue
      }
      if ((keyword === 'for' || keyword === 'select') && index < args.length) {
        // `for var in <words>`：`in` 之后是循环项而非命令，头段放行；
        // 循环体在 `do ...` 段另行分析。非 `var in` 形态跳过循环变量继续分析。
        if (args[index].text === 'in') return null
        index += 1
        continue
      }
      index += 1
      continue
    }
    if (WRAPPER_COMMANDS.has(commandBasename(text))) {
      const wrapper = commandBasename(text)
      index += 1
      const valueFlags =
        wrapper === 'sudo'
          ? new Set([
              '-u',
              '-g',
              '-h',
              '-p',
              '-C',
              '-T',
              '-R',
              '-D',
              '--user',
              '--group',
              '--host',
              '--prompt',
              '--chdir',
              '--chroot',
            ])
          : wrapper === 'env'
            ? new Set(['-u', '--unset', '-C', '--chdir'])
            : wrapper === 'nice'
              ? new Set(['-n', '--adjustment'])
              : new Set<string>()
      while (index < args.length && args[index].text.startsWith('-')) {
        const flag = args[index].text
        if (flag === '--') {
          index += 1
          break
        }
        if (wrapper === 'env' && (flag === '-S' || flag.startsWith('--split-string'))) {
          return 'env 动态拆分命令需要确认'
        }
        index += valueFlags.has(flag) ? 2 : 1
      }
      continue
    }
    break
  }
  if (index >= args.length) return null
  const commandToken = args[index]
  const rest = args.slice(index + 1)

  if (commandToken.text.startsWith('$') || commandToken.text.startsWith('`')) {
    return '命令位由变量动态构造，无法可靠判断删除/终止风险，需要逐次确认'
  }
  const executable = commandBasename(commandToken.text)
  const directReason = deleteReasonForWord(executable)
  if (directReason) return directReason
  if (executable === 'git') return gitDeleteReason(rest)
  if (executable === 'find') return findDeleteReason(rest)
  if (executable === 'xargs') {
    let start = 0
    const valueFlags = new Set([
      '-I',
      '-J',
      '-n',
      '-L',
      '-P',
      '-s',
      '-E',
      '-d',
      '--replace',
      '--max-args',
      '--max-lines',
      '--max-procs',
      '--max-chars',
      '--eof',
      '--delimiter',
    ])
    while (start < rest.length && rest[start].text.startsWith('-')) {
      const flag = rest[start].text
      if (flag === '--') {
        start += 1
        break
      }
      start += valueFlags.has(flag) ? 2 : 1
    }
    return analyzeTokenRangeAsCommandLine(rest.slice(start), depth)
  }
  if (executable === 'eval') return evalReason(rest, depth)
  if (SHELL_INTERPRETERS.has(executable)) {
    return interpreterInlineReason(executable, rest, '-c', depth, true)
  }
  const codeFlag = CODE_INTERPRETER_FLAGS[executable]
  if (codeFlag) return interpreterInlineReason(executable, rest, codeFlag, depth, false)
  return null
}

/** 把剩余 token 还原成命令行文本再递归分析（xargs 的命令操作数）。 */
function analyzeTokenRangeAsCommandLine(tokens: ShellToken[], depth: number): string | null {
  if (tokens.length === 0) return null
  const rebuilt = tokens
    .map((token) =>
      token.quoted || /[\s'"]/.test(token.text) ? JSON.stringify(token.text) : token.text,
    )
    .join(' ')
  return analyzeCommandLine(rebuilt, depth + 1)
}

function evalReason(tokens: ShellToken[], depth: number): string | null {
  if (tokens.length === 0) return null
  const first = tokens[0].text
  if (first.startsWith('$')) {
    return 'eval 的内容由变量动态构造，无法可靠判断删除/终止风险，需要逐次确认'
  }
  const joined = tokens.map((token) => token.text).join(' ')
  return analyzeCommandLine(joined, depth + 1)
}

/**
 * 解释器内联代码（`-c`/`-e` 的操作数）分析。
 * 代码位是纯变量 → fail-closed；否则递归结构化分析（变量按普通 token 处理）。
 * 非 shell 解释器（node/python 等）的代码额外做删除/终止 API 模式扫描。
 * 没有代码 flag 时视为脚本文件执行，按 ADR 0020 不判定。
 */
function interpreterInlineReason(
  executable: string,
  tokens: ShellToken[],
  codeFlag: string,
  depth: number,
  isShellInterpreter: boolean,
): string | null {
  let index = 0
  while (index < tokens.length && tokens[index].text.startsWith('-')) {
    if (isInterpreterCodeFlag(tokens[index].text, codeFlag)) break
    index += 1
  }
  if (index >= tokens.length) return null
  if (!tokens[index].text.startsWith('-')) return null
  const code = tokens[index + 1]
  if (!code) {
    return `${executable} 的内联代码参数缺失，无法判断删除/终止风险，需要逐次确认`
  }
  if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/u.test(code.text)) {
    return `${executable} 内联代码由变量动态构造，无法可靠判断删除/终止风险，需要逐次确认`
  }
  const structural = analyzeCommandLine(code.text, depth + 1)
  if (structural) return structural
  if (!isShellInterpreter) return codeInterpreterDeleteKillPattern(code.text, executable)
  return null
}

/** 非 shell 解释器代码中的删除/终止 API 模式（best-effort，不承诺穷尽）。 */
function codeInterpreterDeleteKillPattern(code: string, executable: string): string | null {
  const patterns: Array<[RegExp, string]> = [
    [
      /\bunlinksync\b|\brmdirsync\b|\brmsync\b/iu,
      '删除类操作（%s 内联代码调用文件删除 API）需要逐次确认',
    ],
    [
      /\bos\.(?:remove|unlink)\b|\bshutil\.rmtree\b/iu,
      '删除类操作（%s 内联代码调用文件删除 API）需要逐次确认',
    ],
    [
      /\bprocess\.kill\b|\.kill\s*\(|\bos\.kill\b|\bsubprocess[^;]*\bkill\b/iu,
      '终止进程类操作（%s 内联代码调用进程终止 API）需要逐次确认',
    ],
  ]
  for (const [pattern, template] of patterns) {
    if (pattern.test(code)) return template.replace('%s', executable)
  }
  return null
}

function gitDeleteReason(tokens: ShellToken[]): string | null {
  let index = 0
  while (index < tokens.length) {
    const text = tokens[index].text
    if (GIT_GLOBAL_FLAG_ARGS.has(text)) {
      index += 2
      continue
    }
    if (text.startsWith('-')) {
      index += 1
      continue
    }
    if (text === 'clean') return '删除类操作（git clean）需要逐次确认'
    if (text === 'rm') return '删除类操作（git rm）需要逐次确认'
    return null
  }
  return null
}

function findDeleteReason(tokens: ShellToken[]): string | null {
  for (let index = 0; index < tokens.length; index += 1) {
    const text = tokens[index].text
    if (text === '-delete' || text === '-deleteall') {
      return '删除类操作（find -delete）需要逐次确认'
    }
    if (text === '-exec' || text === '-execdir') {
      const runner = tokens[index + 1]
      if (runner) {
        const reason = deleteReasonForWord(commandBasename(runner.text))
        if (reason) return `删除类操作（find ${text} ${runner.text}）需要逐次确认`
      }
    }
  }
  return null
}

function deleteReasonForWord(word: string): string | null {
  if (DELETE_COMMANDS.has(word)) return `删除类操作（${word}）需要逐次确认`
  if (KILL_COMMANDS.has(word)) return `终止进程类操作（${word}）需要逐次确认`
  return null
}

function commandBasename(token: string): string {
  // 剥离子 shell/命令组粘连的起始括号（如 `(rm -rf x)` 的 token 是 `(rm`）。
  const withoutGrouping = token.replace(/^[({]+/, '')
  return (withoutGrouping.split('/').pop() ?? withoutGrouping).toLowerCase()
}

function isEnvironmentAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
}

/** heredoc 的保守词扫描：不解析结构，只找命令词形态的删除/终止调用。 */
function rawScanHitsDeleteOrKill(command: string): boolean {
  return /(^|[\s;&|(])(rm|rmdir|unlink|shred|srm|trash|kill|pkill|killall|shutdown|reboot|halt|poweroff)(\s|$|[;&|)])/u.test(
    command,
  )
}

/** 剥离重定向：吞掉重定向操作符及其目标 token；`<<` marker 一并处理（heredoc 已另行保守扫描）。 */
function stripRedirections(tokens: ShellToken[]): ShellToken[] {
  const kept: ShellToken[] = []
  let index = 0
  while (index < tokens.length) {
    const text = tokens[index].text
    if (/^\d*(>>|<|<<)$/.test(text) || text === '&>' || text === '&>>') {
      // 这些操作符需要文件目标：连同下一个 token 一起丢弃。
      index += 2
      continue
    }
    if (/^\d*>&\d*$/.test(text)) {
      index += 1
      continue
    }
    kept.push(tokens[index])
    index += 1
  }
  return kept
}

/** 按顶层操作符切分命令段；引号内不切分。 */
function splitSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let index = 0
  const n = command.length
  while (index < n) {
    const ch = command[index]
    if (ch === "'") {
      const end = command.indexOf("'", index + 1)
      const stop = end === -1 ? n : end
      current += command.slice(index, stop + 1)
      index = stop + 1
      continue
    }
    if (ch === '"') {
      const end = command.indexOf('"', index + 1)
      const stop = end === -1 ? n : end
      current += command.slice(index, stop + 1)
      index = stop + 1
      continue
    }
    if (ch === '\\') {
      current += command.slice(index, index + 2)
      index += 2
      continue
    }
    if (ch === '#' && (index === 0 || /\s/.test(command[index - 1]))) {
      const newline = command.indexOf('\n', index)
      if (newline === -1) break
      index = newline
      continue
    }
    if (ch === '&' && command[index + 1] === '&') {
      segments.push(current)
      current = ''
      index += 2
      continue
    }
    if (ch === '&' && command[index + 1] === '>') {
      current += '&>'
      index += 2
      continue
    }
    if (ch === '|' && command[index + 1] === '|') {
      segments.push(current)
      current = ''
      index += 2
      continue
    }
    if (ch === '|' || ch === ';' || ch === '&' || ch === '\n') {
      segments.push(current)
      current = ''
      index += 1
      continue
    }
    current += ch
    index += 1
  }
  segments.push(current)
  return segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0)
}

interface SubstitutionExtraction {
  rest: string
  inner: string[]
}

/** 抽出 `$(...)`、反引号与 `<( )`/`>( )` 进程替换，返回剩余文本与内层命令。 */
function extractSubstitutions(command: string): SubstitutionExtraction {
  let rest = ''
  const inner: string[] = []
  let index = 0
  let inDoubleQuote = false
  const n = command.length
  while (index < n) {
    const ch = command[index]
    if (ch === "'" && !inDoubleQuote) {
      // 单引号内不发生任何替换；原样保留。
      const end = command.indexOf("'", index + 1)
      const stop = end === -1 ? n : end
      rest += command.slice(index, stop + 1)
      index = stop + 1
      continue
    }
    if (ch === '\\') {
      rest += command.slice(index, index + 2)
      index += 2
      continue
    }
    if (ch === '"') {
      inDoubleQuote = !inDoubleQuote
      rest += ch
      index += 1
      continue
    }
    if (ch === '$' && command[index + 1] === '(') {
      const close = findMatchingParen(command, index + 1)
      inner.push(command.slice(index + 2, close))
      rest += ' '
      index = close + 1
      continue
    }
    if ((ch === '<' || ch === '>') && command[index + 1] === '(') {
      const close = findMatchingParen(command, index + 1)
      inner.push(command.slice(index + 2, close))
      rest += ' '
      index = close + 1
      continue
    }
    if (ch === '`') {
      const end = command.indexOf('`', index + 1)
      const stop = end === -1 ? n : end
      inner.push(command.slice(index + 1, stop))
      rest += ' '
      index = stop + 1
      continue
    }
    rest += ch
    index += 1
  }
  return { rest, inner }
}

function findMatchingParen(command: string, openIndex: number): number {
  let depth = 0
  for (let index = openIndex; index < command.length; index += 1) {
    const ch = command[index]
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return command.length - 1
}

/** 引号感知分词；token 文本已去掉引号，`quoted` 记录是否整体被引号包裹。 */
function tokenize(segment: string): ShellToken[] {
  const tokens: ShellToken[] = []
  let index = 0
  const n = segment.length
  while (index < n) {
    if (/\s/.test(segment[index])) {
      index += 1
      continue
    }
    let text = ''
    let quoted = false
    while (index < n && !/\s/.test(segment[index])) {
      const ch = segment[index]
      if (ch === '\\' && index + 1 < n) {
        text += segment[index + 1]
        index += 2
        continue
      }
      if (ch === '"') {
        quoted = true
        index += 1
        while (index < n && segment[index] !== '"') {
          if (segment[index] === '\\' && index + 1 < n && segment[index + 1] === '"') {
            text += '"'
            index += 2
            continue
          }
          text += segment[index]
          index += 1
        }
        index += 1
        continue
      }
      if (ch === "'") {
        quoted = true
        index += 1
        while (index < n && segment[index] !== "'") {
          text += segment[index]
          index += 1
        }
        index += 1
        continue
      }
      text += ch
      index += 1
    }
    if (text.length > 0) tokens.push({ text, quoted })
  }
  return tokens
}
