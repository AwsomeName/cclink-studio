import { useEffect, useMemo, useState } from 'react'
import type { CclinkServer, CclinkTreeNode } from '@shared/cclink'
import { remoteWorkspaceRef } from '@shared/workspace-ref'
import { useCclinkStore, useOpenProjectsStore, useUIStore } from '../../stores'
import { IconChevronRight, IconCloud, IconFolder, IconRefresh } from '../../components/common/Icons'
import {
  applyWorkspaceRuntimeTransition,
  prepareWorkspaceRuntimeTransition,
} from '../../utils/workspace-transition'

export function CclinkPanel(): React.ReactElement {
  const state = useCclinkStore()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedServer, setSelectedServer] = useState<CclinkServer | null>(null)

  useEffect(() => {
    void state.initialize()
  }, [])

  if (!state.initialized || (state.loading && !state.service)) {
    return <div className="cclink-panel-state">正在检查 CCLink 远程服务…</div>
  }
  if (!state.service?.configured) {
    return (
      <div className="cclink-panel-state">
        <IconCloud size={26} />
        <strong>远程服务未配置</strong>
        <span>{state.service?.message || '本地功能仍可正常使用。'}</span>
      </div>
    )
  }
  if (!state.session.loggedIn) {
    return (
      <div className="cclink-login-card">
        <div className="cclink-login-heading">
          <IconCloud size={22} />
          <div>
            <strong>登录 CCLink</strong>
            <span>仅托管远程服务需要登录</span>
          </div>
        </div>
        <label>
          手机号
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value.replace(/\D/gu, '').slice(0, 11))}
            inputMode="numeric"
            placeholder="请输入手机号"
          />
        </label>
        <div className="cclink-code-row">
          <label>
            验证码
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/gu, '').slice(0, 8))}
              inputMode="numeric"
              placeholder="短信验证码"
            />
          </label>
          <button
            type="button"
            disabled={state.loading || !/^1[3-9]\d{9}$/u.test(phone)}
            onClick={() => {
              setNotice(null)
              void state.sendCode(phone).then((result) => {
                setCodeSent(result.success)
                setNotice(result.success ? '验证码已发送' : result.error || '发送失败')
              })
            }}
          >
            {codeSent ? '重新发送' : '发送验证码'}
          </button>
        </div>
        {(notice || state.error) && (
          <div className="cclink-inline-notice">{notice || state.error}</div>
        )}
        <button
          className="cclink-primary"
          type="button"
          disabled={state.loading || !/^1[3-9]\d{9}$/u.test(phone) || !/^\d{4,8}$/u.test(code)}
          onClick={() => void state.login(phone, code)}
        >
          {state.loading ? '登录并连接中…' : '登录并连接远程服务'}
        </button>
        <p>登录不会解锁或限制本地工作区、Agent、浏览器、编辑器、Terminal、数据源或 Android。</p>
      </div>
    )
  }

  if (selectedServer) {
    return <RemoteDirectoryPicker server={selectedServer} onBack={() => setSelectedServer(null)} />
  }

  return (
    <div className="cclink-server-panel">
      <div className="cclink-account-row">
        <div>
          <strong>
            {state.session.user?.nickname || state.session.user?.phone || 'CCLink 用户'}
          </strong>
          <span>
            {state.realtime.state === 'online'
              ? '实时连接在线'
              : state.realtime.error || state.realtime.state}
          </span>
        </div>
        <button type="button" onClick={() => void state.logout()}>
          退出
        </button>
      </div>
      <div className="cclink-section-heading">
        <span>已配对设备</span>
        <button type="button" title="刷新设备" onClick={() => void state.refreshServers()}>
          <IconRefresh size={14} />
        </button>
      </div>
      {state.error && <div className="cclink-inline-notice error">{state.error}</div>}
      <div className="cclink-server-list">
        {state.servers.map((server) => (
          <button
            key={server.id}
            type="button"
            disabled={server.status !== 'online'}
            onClick={() => setSelectedServer(server)}
          >
            <span className={`cclink-status-dot ${server.status}`} />
            <span>
              <strong>{server.name}</strong>
              <small>
                {server.hostname} · {server.status === 'online' ? '在线' : '离线'}
              </small>
            </span>
            <IconChevronRight size={13} />
          </button>
        ))}
        {state.servers.length === 0 && <div className="cclink-panel-state">暂无已配对设备</div>}
      </div>
    </div>
  )
}

function RemoteDirectoryPicker({
  server,
  onBack,
}: {
  server: CclinkServer
  onBack(): void
}): React.ReactElement {
  const pendingPermissions = useCclinkStore((state) => state.pendingPermissions)
  const respondPermission = useCclinkStore((state) => state.respondPermission)
  const initialPath = useMemo(
    () => server.workspaces.find((item) => item.exists !== false)?.path || '/',
    [server],
  )
  const [path, setPath] = useState(initialPath)
  const [tree, setTree] = useState<CclinkTreeNode | null>(null)
  const [loading, setLoading] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const directories = tree?.children?.filter((item) => item.type === 'directory') ?? []

  const load = async (target: string): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.cclinkStudio.cclink.browseDirectory({
        serverId: server.id,
        path: target,
      })
      if (!result.success || !result.tree) throw new Error(result.error || '目录读取失败')
      setTree(result.tree)
      setPath(result.tree.path)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load(initialPath)
  }, [initialPath])

  const openCurrent = async (): Promise<void> => {
    setOpening(true)
    setError(null)
    try {
      const workspace = await window.cclinkStudio.cclink.openWorkspace({
        serverId: server.id,
        path,
      })
      const ref = remoteWorkspaceRef({
        endpointId: server.id,
        workspaceId: workspace.id,
        path: workspace.path,
        label: workspace.name,
        endpointName: server.name,
      })
      const transition = await prepareWorkspaceRuntimeTransition(ref)
      const applied = await applyWorkspaceRuntimeTransition(transition)
      if (!applied) throw new Error('工作空间已发生变化，请重试')
      useOpenProjectsStore.getState().addRemoteProject(ref)
      useUIStore.getState().setActivePanel('files')
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError))
    } finally {
      setOpening(false)
    }
  }
  const parent = parentPath(path)
  return (
    <div className="cclink-directory-picker">
      <div className="cclink-directory-header">
        <button type="button" onClick={onBack}>
          返回设备
        </button>
        <strong>{server.name}</strong>
      </div>
      <div className="cclink-directory-toolbar">
        <button
          type="button"
          disabled={!parent || loading}
          onClick={() => parent && void load(parent)}
        >
          上级
        </button>
        <button type="button" disabled={loading} onClick={() => void load(path)}>
          <IconRefresh size={13} />
        </button>
        <span title={path}>{path}</span>
      </div>
      <div className="cclink-directory-list">
        {directories.map((directory) => (
          <button type="button" key={directory.path} onClick={() => void load(directory.path)}>
            <IconFolder size={14} />
            <span>{directory.name}</span>
            <IconChevronRight size={12} />
          </button>
        ))}
        {loading && <div className="cclink-panel-state">正在读取远程目录…</div>}
        {!loading && directories.length === 0 && !error && (
          <div className="cclink-panel-state">当前目录没有子目录</div>
        )}
      </div>
      {error && <div className="cclink-inline-notice error">{error}</div>}
      {pendingPermissions
        .filter((permission) => permission.serverId === server.id)
        .map((permission) => (
          <div key={permission.requestId} className="cclink-inline-notice warning">
            <strong>远程设备请求目录权限</strong>
            <span>
              {permission.operation} · {permission.path}
            </span>
            <button
              type="button"
              onClick={() =>
                void respondPermission(permission.serverId, permission.requestId, false)
              }
            >
              拒绝
            </button>
            <button
              type="button"
              onClick={() =>
                void respondPermission(permission.serverId, permission.requestId, true)
              }
            >
              允许本次访问
            </button>
          </div>
        ))}
      <button
        type="button"
        className="cclink-primary"
        disabled={loading || opening || Boolean(error)}
        onClick={() => void openCurrent()}
      >
        {opening ? '正在打开…' : '作为远程项目打开'}
      </button>
    </div>
  )
}

function parentPath(path: string): string | null {
  const normalized = path.replace(/[\\/]+$/u, '')
  if (!normalized || normalized === '/' || /^[A-Za-z]:$/u.test(normalized)) return null
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (index < 0) return null
  if (index === 0) return '/'
  return normalized.slice(0, index)
}
