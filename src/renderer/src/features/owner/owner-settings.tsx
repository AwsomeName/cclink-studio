import { useEffect, useState } from 'react'
import type { OwnerWebStatus } from '@shared/ipc/owner-web'
import {
  DEFAULT_WEB_LIMIT,
  defaultRuntimeOrder,
  ownerRuntimeKinds,
  type OwnerPreferencesView,
  type OwnerRuntimeKind,
  type OwnerWorkType,
} from '@shared/ipc/owner-preferences'
import { useOwnerPrefs } from './owner-status'

const RUNTIME: Record<OwnerRuntimeKind, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }
const WORK: [OwnerWorkType, string, string][] = [
  ['coordinate', '统筹', 'Owner 自己：维护事务文件、拆解、判断'],
  ['research', '检索取证', '执行会话 A、B…：读资料、查源码、记出处'],
]

/** Owner-wide defaults. Nothing here grants a read permission. */
export function OwnerSettings() {
  const prefs = useOwnerPrefs((s) => s.prefs)
  const loadError = useOwnerPrefs((s) => s.error)
  const setPrefs = useOwnerPrefs((s) => s.set)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [web, setWeb] = useState<OwnerWebStatus | null>(null)
  const [limitDraft, setLimitDraft] = useState('')
  useEffect(() => {
    let live = true
    void window.cclinkStudio.ownerWeb
      .status()
      .then((s) => live && setWeb(s))
      .catch(() => live && setWeb({ ready: false, reason: '联网搜索服务未就绪' }))
    return () => {
      live = false
    }
  }, [])
  async function run(fn: () => Promise<OwnerPreferencesView | null>) {
    setBusy(true)
    setError('')
    try {
      const next = await fn()
      if (next) setPrefs(next)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  const api = window.cclinkStudio.ownerPreferences
  if (!prefs)
    return (
      <div className="own-settings">
        <h1>Owner 设置</h1>
        {loadError ? <p role="alert">{loadError}</p> : <p>读取中…</p>}
      </div>
    )
  // An older main process may not report runtimes yet; show the defaults it would use.
  const runtimes = prefs.runtimes ?? defaultRuntimeOrder()
  const references = prefs.roots.filter((r) => r.purpose === 'reference')
  const outputs = prefs.roots.filter((r) => r.purpose === 'output')
  return (
    <div className="own-settings">
      <h1>Owner 设置</h1>
      <div className="own-banner">
        这里只设定默认值，不授予任何权限。读取本地目录必须在具体事务里单独授权。
      </div>
      {error && <p role="alert">{error}</p>}

      <section className="own-set">
        <h3>新事务保存位置</h3>
        <div>
          <div className="own-box" data-owner-save-location={prefs.saveLocation.path}>
            <span>📁 {prefs.saveLocation.path}</span>
            {!prefs.saveLocation.custom && <span className="own-tag">我的空间（默认）</span>}
            <span className="own-flex" />
            <button disabled={busy} onClick={() => void run(() => api.register('output'))}>
              更改…
            </button>
            {prefs.saveLocation.custom && (
              <button disabled={busy} onClick={() => void run(() => api.setDefaultParent(null))}>
                恢复默认
              </button>
            )}
          </div>
          {prefs.saveLocation.error && <p role="alert">{prefs.saveLocation.error}</p>}
          {outputs.length > 1 && (
            <div className="own-choices">
              {outputs
                .filter((r) => r.id !== prefs.defaultParentId)
                .map((r) => (
                  <div className="own-box" key={r.id}>
                    <span>📁 {r.path}</span>
                    <span className="own-flex" />
                    <button
                      disabled={busy || !!r.error}
                      onClick={() => void run(() => api.setDefaultParent(r.id))}
                    >
                      设为默认
                    </button>
                    <button disabled={busy} onClick={() => void run(() => api.remove(r.id))}>
                      移除
                    </button>
                  </div>
                ))}
            </div>
          )}
          <small>
            只影响以后新建的事务，已有事务不搬动。只在新建的事务子目录内写入，不读取该位置的其他文件。
          </small>
        </div>
      </section>

      <section className="own-set">
        <h3>常用参考目录</h3>
        <div>
          {references.map((r) => (
            <div className="own-box" key={r.id} data-owner-root={r.label}>
              <span title={r.path}>📁 {r.path}</span>
              <span className="own-tag">
                已登记 · {r.grantedAffairs ? '已授权给 ' + r.grantedAffairs + ' 件事务' : '未授权'}
              </span>
              <span className="own-flex" />
              <button disabled={busy} onClick={() => void run(() => api.remove(r.id))}>
                移除
              </button>
              {r.error && <small role="alert">{r.error}</small>}
            </div>
          ))}
          <button disabled={busy} onClick={() => void run(() => api.register('reference'))}>
            ＋ 登记目录…
          </button>
          <small>
            登记后只出现在授权时的候选列表；要在具体事务里选择并确认授权后才能读取。移除登记不撤销已有授权。
          </small>
        </div>
      </section>

      <section className="own-set" data-owner-channels>
        <h3>取证通道</h3>
        <div>
          <div className="own-box" data-owner-channel="web">
            <span>
              <b>公开网页</b>
              <small>
                搜索、读取公开网页；经 DeepSeek，约 0.75 美元 / 千次，用量计入"Owner 调研"
              </small>
            </span>
            <span className="own-flex" />
            <span className={'own-tag' + (web?.ready ? ' ok' : '')}>
              {web ? (web.ready ? '已就绪' : '未开放') : '检查中…'}
            </span>
          </div>
          {web && !web.ready && <small role="status">{web.reason}</small>}
          <div className="own-box">
            <span>
              <b>GitHub 仓库文件</b>
              <small>公开仓库的 README、文档和源码；沿用已保存的 GitHub 凭证</small>
            </span>
            <span className="own-flex" />
            <span className="own-tag ok">已就绪</span>
          </div>
          <div className="own-box">
            <span>
              <b>本地参考目录</b>
              <small>按事务授权，只读</small>
            </span>
            <span className="own-flex" />
            <span className="own-tag ok">已就绪</span>
          </div>
          <label className="own-check" data-owner-web-limit>
            每件事务默认联网上限{' '}
            <input
              type="number"
              min={1}
              max={200}
              value={limitDraft || String(prefs.webLimit ?? DEFAULT_WEB_LIMIT)}
              disabled={busy}
              onChange={(e) => setLimitDraft(e.target.value)}
              onBlur={() => {
                const v = Math.round(Number(limitDraft))
                setLimitDraft('')
                if (Number.isFinite(v) && v >= 1 && v <= 200 && v !== prefs.webLimit)
                  void run(() => api.update({ webLimit: v }))
              }}
              style={{ width: 64 }}
            />{' '}
            次
          </label>
          <small>
            搜索和读取一页各算 1 次；新事务的约定按这个值起草。用到上限时在右侧问你是否追加 10
            次，60 秒无回应就停止联网，用已有资料继续。模型自带的搜索只算线索，Studio
            搜索或读取存档后才能被引用。
          </small>
        </div>
      </section>

      <section className="own-set" data-owner-runtimes>
        <h3>运行时分工</h3>
        <div>
          {WORK.map(([type, title, hint]) => {
            const order = runtimes[type]
            const save = (next: OwnerRuntimeKind[]) =>
              void run(() => api.update({ runtimes: { ...runtimes, [type]: next } }))
            return (
              <div className="own-box" key={type} data-owner-work-type={type}>
                <span>
                  <b>{title}</b>
                  <small>{hint}</small>
                </span>
                <span className="own-flex" />
                <label>
                  首选{' '}
                  <select
                    aria-label={title + '首选运行时'}
                    value={order[0]}
                    disabled={busy}
                    onChange={(e) => {
                      const first = e.target.value as OwnerRuntimeKind
                      save([first, ...order.filter((k) => k !== first)].slice(0, order.length))
                    }}
                  >
                    {ownerRuntimeKinds.map((k) => (
                      <option key={k} value={k}>
                        {RUNTIME[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  备选{' '}
                  <select
                    aria-label={title + '备选运行时'}
                    value={order[1] ?? ''}
                    disabled={busy}
                    onChange={(e) =>
                      save(
                        e.target.value
                          ? [order[0], e.target.value as OwnerRuntimeKind]
                          : [order[0]],
                      )
                    }
                  >
                    <option value="">不用备选</option>
                    {ownerRuntimeKinds
                      .filter((k) => k !== order[0])
                      .map((k) => (
                        <option key={k} value={k}>
                          {RUNTIME[k]}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            )
          })}
          <small>
            新开会话时按顺序取第一个就绪的运行时，原因写进事务的分工和工作记录；已有会话不换运行时。没有备选且首选未就绪时，这一步会报错等你处理。独立构思、写作文案、审查核对和
            Gemini CLI 会在后续接入。
          </small>
        </div>
      </section>

      <section className="own-set">
        <h3>常用来源</h3>
        <div>
          {(
            [
              ['github', '官方 GitHub 仓库'],
              ['docs', '官方文档站'],
              ['thirdParty', '论文与第三方博客'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="own-check">
              <input
                type="checkbox"
                checked={prefs.sources[key]}
                disabled={busy}
                onChange={(e) =>
                  void run(() =>
                    api.update({ sources: { ...prefs.sources, [key]: e.target.checked } }),
                  )
                }
              />
              {label}
            </label>
          ))}
          <small>Owner 拟约定时参考这些偏好；具体范围以每件事务确认的约定为准。</small>
        </div>
      </section>

      <section className="own-set">
        <h3>交付格式</h3>
        <div>
          <p>中文 Markdown；结论附固定版本原文引用。</p>
        </div>
      </section>

      <section className="own-set">
        <h3>需要我时提醒</h3>
        <div>
          <label className="own-check">
            <input
              type="checkbox"
              checked={prefs.reminders.topbarCount}
              disabled={busy}
              onChange={(e) =>
                void run(() => api.update({ reminders: { topbarCount: e.target.checked } }))
              }
            />
            顶栏计数
          </label>
          <small>只在等你确认、等你提供资料或需要你处理时计数；Owner 自己补查不计。</small>
        </div>
      </section>
    </div>
  )
}
