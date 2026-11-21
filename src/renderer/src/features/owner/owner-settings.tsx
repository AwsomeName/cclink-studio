import { useState } from 'react'
import type { OwnerPreferencesView } from '@shared/ipc/owner-preferences'
import { useOwnerPrefs } from './owner-status'

/** Owner-wide defaults. Nothing here grants a read permission. */
export function OwnerSettings() {
  const prefs = useOwnerPrefs((s) => s.prefs)
  const loadError = useOwnerPrefs((s) => s.error)
  const setPrefs = useOwnerPrefs((s) => s.set)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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
          <small>
            Owner 拟约定时参考这些偏好；具体范围以每件事务确认的约定为准。当前开发版取证仍只读公开
            GitHub 仓库。
          </small>
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
