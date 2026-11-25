import { useCallback, useEffect, useState } from 'react'
import {
  SEARXNG_DEFAULT_ENGINES,
  TECHDAILY_PROVIDER_LABELS,
  type SearxngConfigInput,
  type SearxngConfigSnapshot,
  type SearxngTestResult,
  type TechDailyCollectResult,
  type TechDailyOptions,
  type TechDailyProvider,
  type TechDailyResult,
  type TechDailySettingsSnapshot,
  type TechDailyStatus,
} from '@shared/techdaily/techdaily-types'
import { WEB_SEARCH_PRICE_PER_CALL_USD } from '@shared/web-search/web-search-types'
import type { WorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores/tab-store'
import './techdaily-settings.css'

async function unwrap<T>(promise: Promise<TechDailyResult<T>>): Promise<T> {
  const result = await promise
  if (!result.success) throw new Error(result.error)
  return result.data
}

type AuthMode = 'keep' | 'none' | 'basic'

function optionsOf(snapshot: TechDailySettingsSnapshot): TechDailyOptions {
  const s = snapshot.settings
  return {
    enabled: s.enabled,
    search_provider: s.search_provider,
    freshness_days: s.freshness_days,
    keep_undated: s.keep_undated,
    results_per_query: s.results_per_query,
    daily_call_limit: s.daily_call_limit,
  }
}

function Merged({ children }: { children: string }): React.ReactElement {
  return (
    <span className="techdaily-merged" title={children}>
      合并
    </span>
  )
}

function SearxngTest({ result }: { result: SearxngTestResult }): React.ReactElement {
  const engines = Object.entries(result.engines).sort((a, b) => b[1] - a[1])
  return (
    <div className={'techdaily-test ' + (result.ok ? 'ok' : 'bad')} role="status">
      <strong>
        {result.ok ? '✓ ' : '✗ '}
        {result.message}
      </strong>
      <small>
        测试词“{result.query}” · {(result.durationMs / 1000).toFixed(1)} 秒 ·{' '}
        {new Date(result.testedAt).toLocaleString()}
      </small>
      {engines.length > 0 && (
        <small>引擎分布：{engines.map(([e, n]) => `${e} ${n}`).join('、')}</small>
      )}
      {result.sample.length > 0 && (
        <ul>
          {result.sample.map((s) => (
            <li key={s.url}>
              <span>{s.date ?? '无日期'}</span> {s.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CollectResult({ result }: { result: TechDailyCollectResult }): React.ReactElement {
  const total = (key: keyof TechDailyCollectResult['domains'][number]) =>
    result.domains.reduce((n, d) => n + (d[key] as number), 0)
  const datedPct = result.articles ? Math.round((result.dated / result.articles) * 100) : 0
  return (
    <div className="techdaily-collect" aria-label="试采结果">
      <p role="status">
        {TECHDAILY_PROVIDER_LABELS[result.provider]} · {result.requests} 次搜索
        {result.failedRequests ? `（失败 ${result.failedRequests}）` : ''} ·{' '}
        {(result.durationMs / 1000).toFixed(0)} 秒 → 原始 {total('raw')} 条，留下 {result.articles}{' '}
        篇（带日期 {datedPct}%），本机库新增 {result.inserted}、再次出现 {result.updated}
      </p>
      {result.stoppedReason && <p role="alert">提前停止：{result.stoppedReason}</p>}
      <div className="techdaily-table-wrap">
        <table>
          <thead>
            <tr>
              <th>领域</th>
              <th>搜索</th>
              <th>原始</th>
              <th title="百科、官网、下载页等域名">黑名单</th>
              <th title="不是采用的引擎返回的">引擎</th>
              <th title="标题含排除词">排除词</th>
              <th title="早于时效天数">过期</th>
              <th title="标题不含搜索词或领域关键词">跑题</th>
              <th title="同一网址被多个搜索词搜到">同网址</th>
              <th>留下</th>
              <th>无日期</th>
            </tr>
          </thead>
          <tbody>
            {result.domains.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>
                  {d.requests}
                  {d.failedRequests ? ` (✗${d.failedRequests})` : ''}
                </td>
                <td>{d.raw}</td>
                <td>{d.denied + d.invalid}</td>
                <td>{d.engineRejected}</td>
                <td>{d.excluded}</td>
                <td>{d.stale}</td>
                <td>{d.guarded}</td>
                <td>{d.mergedInDomain}</td>
                <td>
                  <strong>{d.kept}</strong>
                </td>
                <td>{d.undated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small>跨领域同网址合并 {result.mergedAcrossDomains} 篇（归首个命中的领域）。</small>
      {result.samples.length > 0 && (
        <details>
          <summary>最新 {result.samples.length} 篇（只用于核对，不是日报）</summary>
          <ul className="techdaily-samples">
            {result.samples.map((s) => (
              <li key={s.url}>
                <span>{s.date ?? '无日期'}</span>
                <span>{result.domains.find((d) => d.id === s.domain)?.name ?? s.domain}</span>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/**
 * 项目设置 · 我的空间 · 科技日报. The main-process TechDailyService owns the file
 * `科技日报/设置.yaml`, the SearXNG connection on this machine and collection.
 */
export function TechDailySettingsSection({
  workspaceRef,
}: {
  workspaceRef: Extract<WorkspaceRef, { kind: 'local' }>
}): React.ReactElement {
  const workspacePath = workspaceRef.path
  const api = window.cclinkStudio.techDaily
  const [snapshot, setSnapshot] = useState<TechDailySettingsSnapshot | null>(null)
  const [options, setOptions] = useState<TechDailyOptions | null>(null)
  const [status, setStatus] = useState<TechDailyStatus | null>(null)
  const [searxng, setSearxng] = useState<SearxngConfigSnapshot | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [engines, setEngines] = useState<string>(SEARXNG_DEFAULT_ENGINES.join(', '))
  const [authMode, setAuthMode] = useState<AuthMode>('none')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [test, setTest] = useState<SearxngTestResult | null>(null)
  const [collect, setCollect] = useState<TechDailyCollectResult | null>(null)
  const [busy, setBusy] = useState<'' | 'save' | 'searxng' | 'test' | 'collect'>('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const [next, nextStatus, nextSearxng] = await Promise.all([
        unwrap(api.getSettings({ workspacePath })),
        unwrap(api.getStatus({ workspacePath })),
        unwrap(api.getSearxng()),
      ])
      setSnapshot(next)
      setOptions(optionsOf(next))
      setStatus(nextStatus)
      if (nextStatus.lastCollect) setCollect(nextStatus.lastCollect)
      setSearxng(nextSearxng)
      setBaseUrl(nextSearxng.baseUrl ?? '')
      setEngines(nextSearxng.engines.join(', '))
      setAuthMode(nextSearxng.hasPassword ? 'keep' : 'none')
      setUsername(nextSearxng.username ?? '')
      setPassword('')
      setTest(nextSearxng.lastTest ?? null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [api, workspacePath])

  useEffect(() => {
    void load()
  }, [load])

  if (!snapshot || !options)
    return (
      <section className="techdaily-settings" aria-label="科技日报设置">
        <h3>科技日报</h3>
        {error ? <p role="alert">{error}</p> : <p role="status">正在读取科技日报设置…</p>}
      </section>
    )

  const set = <K extends keyof TechDailyOptions>(key: K, value: TechDailyOptions[K]) =>
    setOptions({ ...options, [key]: value })
  const dirty = JSON.stringify(options) !== JSON.stringify(optionsOf(snapshot))
  const searxngInput = (): SearxngConfigInput => ({
    baseUrl: baseUrl.trim(),
    engines: engines
      .split(/[,，\n]/)
      .map((e) => e.trim())
      .filter(Boolean),
    auth:
      authMode === 'basic'
        ? { mode: 'basic', username: username.trim(), password }
        : { mode: authMode },
  })
  const searxngDirty =
    !!searxng &&
    (baseUrl.trim().replace(/\/+$/, '') !== (searxng.baseUrl ?? '') ||
      engines !== searxng.engines.join(', ') ||
      authMode === 'basic' ||
      (authMode === 'none' && searxng.hasPassword))
  const queryCount = snapshot.queryCount
  const plannedCalls =
    options.daily_call_limit > 0 ? Math.min(queryCount, options.daily_call_limit) : queryCount
  const provider: TechDailyProvider = options.search_provider

  const run = async (kind: typeof busy, work: () => Promise<void>) => {
    setBusy(kind)
    setError('')
    setNotice('')
    try {
      await work()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const save = () =>
    run('save', async () => {
      const next = await unwrap(
        api.saveSettings({ workspacePath, revision: snapshot.revision, options }),
      )
      setSnapshot(next)
      setOptions(optionsOf(next))
      setStatus(await unwrap(api.getStatus({ workspacePath })))
      setNotice(`已保存到 ${next.filePath}，随我的空间同步。`)
    })

  const saveSearxng = () =>
    run('searxng', async () => {
      const next = await unwrap(api.saveSearxng(searxngInput()))
      setSearxng(next)
      setEngines(next.engines.join(', '))
      setBaseUrl(next.baseUrl ?? '')
      setAuthMode(next.hasPassword ? 'keep' : 'none')
      setPassword('')
      setStatus(await unwrap(api.getStatus({ workspacePath })))
      setNotice('SearXNG 地址已保存在这台电脑；凭证在 Studio 凭证文件中，不随同步。')
    })

  const testSearxng = () =>
    run('test', async () => {
      setTest(await unwrap(api.testSearxng(searxngInput())))
    })

  const startCollect = () => {
    const cost =
      provider === 'deepseek'
        ? `约 ${plannedCalls} 次 DeepSeek 搜索，约 $${(plannedCalls * WEB_SEARCH_PRICE_PER_CALL_USD).toFixed(3)}`
        : `约 ${plannedCalls} 次 SearXNG 搜索，每次间隔 3.5 秒，约 ${Math.ceil((plannedCalls * 3.5) / 60)} 分钟`
    if (
      !window.confirm(
        `试采一轮：按词表每个搜索词搜一次，只过滤和合并网址，不生成日报。\n${cost}。继续？`,
      )
    )
      return
    void run('collect', async () => {
      const result = await unwrap(api.collect({ workspacePath }))
      setCollect(result)
      setStatus(await unwrap(api.getStatus({ workspacePath })))
    })
  }

  const openFile = () =>
    useTabStore.getState().openTab({
      type: 'editor',
      title: '设置.yaml',
      filePath: `${workspacePath}/${snapshot.filePath}`,
      workspaceRef,
      icon: '📄',
    })

  const openWebSearch = () =>
    useTabStore.getState().openTab({
      type: 'settings',
      title: '设置',
      icon: '⚙️',
      settingsSection: 'connections:web-search',
    })

  return (
    <section className="techdaily-settings" aria-label="科技日报设置">
      <h3>
        科技日报 <span className="techdaily-new">新</span>
      </h3>
      <p>
        每天按领域搜索科技新闻，过滤、去重后由本机 AI 精选成稿。设置写在{' '}
        <code>{snapshot.filePath}</code>，随我的空间同步。
      </p>
      {snapshot.status === 'invalid' && (
        <p role="alert">{snapshot.error}。页面显示的是默认词表；修正文件后点“重新读取”。</p>
      )}
      {snapshot.status === 'missing' && (
        <p className="techdaily-hint">
          还没有设置文件：保存时按 Argus 词表创建（9 个领域、{queryCount} 个搜索词）。
        </p>
      )}
      <label>
        <input
          type="checkbox"
          aria-label="开启科技日报"
          checked={options.enabled}
          onChange={(e) => set('enabled', e.target.checked)}
        />
        开启科技日报
      </label>

      <fieldset>
        <legend>搜索服务</legend>
        <label className="techdaily-radio">
          <input
            type="radio"
            name="techdaily-provider"
            aria-label="使用 DeepSeek 联网搜索"
            checked={provider === 'deepseek'}
            onChange={() => set('search_provider', 'deepseek')}
          />
          <span>
            <strong>
              DeepSeek 联网搜索 <Merged>沿用 Studio 设置 · 联网搜索的 Key 与每月上限</Merged>
            </strong>
            <small>
              沿用“Studio 设置 · API Key 与连接 · 联网搜索”的 Key 和每月上限，不另填。每次搜索约 $
              {WEB_SEARCH_PRICE_PER_CALL_USD}。
            </small>
            {provider === 'deepseek' && status && (
              <small className={status.providers.deepseek.ready ? 'techdaily-ok' : 'techdaily-bad'}>
                {status.providers.deepseek.ready
                  ? '✓ 可用'
                  : `✗ ${status.providers.deepseek.reason}`}{' '}
                <button type="button" onClick={openWebSearch}>
                  打开联网搜索设置
                </button>
              </small>
            )}
          </span>
        </label>
        <label className="techdaily-radio">
          <input
            type="radio"
            name="techdaily-provider"
            aria-label="使用 SearXNG 远程服务"
            checked={provider === 'searxng'}
            onChange={() => set('search_provider', 'searxng')}
          />
          <span>
            <strong>SearXNG 远程服务</strong>
            <small>用你自己部署的 SearXNG，搜索免费。地址和凭证只存在这台电脑，不随同步。</small>
            {provider === 'searxng' && status && !status.providers.searxng.ready && (
              <small className="techdaily-bad">✗ {status.providers.searxng.reason}</small>
            )}
          </span>
        </label>
        {provider === 'searxng' && (
          <div className="techdaily-searxng" aria-label="SearXNG 连接">
            <label>
              服务地址
              <input
                aria-label="SearXNG 服务地址"
                placeholder="https://searx.example.com"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
              <small>
                需要服务端开启 JSON 输出（settings.yml 的 search.formats 含 json）。不会传
                time_range，时效由 Studio 判断。
              </small>
            </label>
            <label>
              只采用这些引擎
              <input
                aria-label="SearXNG 采用的引擎"
                value={engines}
                onChange={(e) => setEngines(e.target.value)}
              />
              <small>
                逗号分隔。其他引擎返回的结果丢弃（Argus 实测 engines 参数不能排除其他引擎）。
              </small>
            </label>
            <div className="techdaily-auth" role="radiogroup" aria-label="访问凭证">
              <span>访问凭证</span>
              <label>
                <input
                  type="radio"
                  name="searxng-auth"
                  checked={authMode === 'none'}
                  onChange={() => setAuthMode('none')}
                />
                不需要
              </label>
              {searxng?.hasPassword && (
                <label>
                  <input
                    type="radio"
                    name="searxng-auth"
                    checked={authMode === 'keep'}
                    onChange={() => setAuthMode('keep')}
                  />
                  保持已保存（{searxng.username}）
                </label>
              )}
              <label>
                <input
                  type="radio"
                  name="searxng-auth"
                  checked={authMode === 'basic'}
                  onChange={() => setAuthMode('basic')}
                />
                用户名和密码（Basic）
              </label>
            </div>
            {authMode === 'basic' && (
              <div className="techdaily-row">
                <label>
                  用户名
                  <input
                    aria-label="SearXNG 用户名"
                    autoComplete="off"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </label>
                <label>
                  密码
                  <input
                    aria-label="SearXNG 密码"
                    type="password"
                    autoComplete="off"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              </div>
            )}
            <div className="workspace-form-actions">
              <button
                type="button"
                disabled={!!busy || !baseUrl.trim()}
                onClick={() => void testSearxng()}
              >
                {busy === 'test' ? '正在测试…' : '测试连接'}
              </button>
              <button
                type="button"
                disabled={!!busy || !baseUrl.trim() || !searxngDirty}
                onClick={() => void saveSearxng()}
              >
                {busy === 'searxng' ? '正在保存…' : '保存 SearXNG 连接'}
              </button>
            </div>
            {test && <SearxngTest result={test} />}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>采集与过滤</legend>
        <div className="techdaily-row">
          <label>
            只要近几天的
            <input
              aria-label="时效天数"
              type="number"
              min={1}
              max={14}
              value={options.freshness_days}
              onChange={(e) => set('freshness_days', Number(e.target.value))}
            />
          </label>
          <label>
            每个搜索词取前
            <input
              aria-label="每个搜索词取前几条"
              type="number"
              min={5}
              max={20}
              value={options.results_per_query}
              onChange={(e) => set('results_per_query', Number(e.target.value))}
            />
          </label>
          <label>
            一次最多搜索
            <input
              aria-label="一次最多搜索次数"
              type="number"
              min={0}
              max={500}
              value={options.daily_call_limit}
              onChange={(e) => set('daily_call_limit', Number(e.target.value))}
            />
            <small>0 = 只受联网搜索每月上限约束</small>
          </label>
        </div>
        <label>
          <input
            type="checkbox"
            aria-label="保留无日期的结果"
            checked={options.keep_undated}
            onChange={(e) => set('keep_undated', e.target.checked)}
          />
          网址和搜索结果都没有日期时仍保留（Argus 默认）
        </label>
      </fieldset>

      <fieldset>
        <legend>领域与搜索词</legend>
        <ul className="techdaily-domains">
          {snapshot.settings.domains.map((d) => (
            <li key={d.id}>
              <strong>{d.name}</strong>
              <small>
                中文 {d.queries.zh.length} · 英文 {d.queries.en.length}
                {d.match.length ? ` · 护栏词 ${d.match.length}` : ''}
              </small>
            </li>
          ))}
        </ul>
        <small>
          共 {queryCount} 个搜索词；排除词 {snapshot.settings.exclude_keywords.length}{' '}
          个。词表、护栏词、排除词和口味直接编辑设置文件，可粘贴 Argus 的 queries.yaml。
        </small>
        <div className="workspace-form-actions">
          <button type="button" disabled={snapshot.status !== 'saved'} onClick={openFile}>
            编辑 设置.yaml
          </button>
          <button type="button" disabled={!!busy} onClick={() => void load()}>
            重新读取
          </button>
        </div>
      </fieldset>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="workspace-form-actions">
        <button
          type="button"
          disabled={
            !!busy || snapshot.status === 'invalid' || (!dirty && snapshot.status === 'saved')
          }
          onClick={() => void save()}
        >
          {busy === 'save' ? '正在保存…' : '保存科技日报设置'}
        </button>
        <button
          type="button"
          disabled={!!busy || dirty || snapshot.status !== 'saved' || !status?.ready}
          title={dirty ? '先保存设置' : status?.ready ? '' : status?.reason}
          onClick={startCollect}
        >
          {busy === 'collect' ? '正在试采…' : '试采一轮'}
        </button>
      </div>
      <small>
        试采：按词表每个搜索词搜一次（约 {plannedCalls} 次），只做过滤和网址合并，存进本机库，不调用
        AI、不生成日报。
        {status ? ` 今天已用 ${status.callsToday} 次。` : ''}
      </small>
      {busy === 'collect' && (
        <p role="status">
          正在搜索 {plannedCalls} 个词{provider === 'searxng' ? '，SearXNG 每次间隔 3.5 秒' : ''}…
        </p>
      )}
      {collect && <CollectResult result={collect} />}
    </section>
  )
}
