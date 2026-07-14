import { useEffect, useState } from 'react'
import type { ChatccServer } from '@shared/chatcc'
import { useAuthStore, useCclinkStore } from '../../stores'
import { IconChevronDown, IconFile, IconFolder, IconLink, IconRobot } from '../common/Icons'

function serverStatusLabel(status: ChatccServer['status']): string {
  switch (status) {
    case 'online':
      return '在线'
    case 'connecting':
      return '连接中'
    case 'offline':
      return '离线'
  }
}

function realtimeStatusLabel(state: string): string {
  switch (state) {
    case 'online':
      return '实时链路在线'
    case 'connecting':
      return '正在连接'
    case 'offline':
      return '实时链路已断开'
    case 'error':
      return '实时链路异常'
    case 'idle':
    default:
      return '实时链路未连接'
  }
}

export function CclinkPanel(): React.ReactElement {
  const servers = useCclinkStore((s) => s.servers)
  const identity = useCclinkStore((s) => s.identity)
  const realtimeStatus = useCclinkStore((s) => s.realtimeStatus)
  const loading = useCclinkStore((s) => s.loading)
  const identityLoading = useCclinkStore((s) => s.identityLoading)
  const preflightLoading = useCclinkStore((s) => s.preflightLoading)
  const realtimeLoading = useCclinkStore((s) => s.realtimeLoading)
  const legacyPreflight = useCclinkStore((s) => s.legacyPreflight)
  const error = useCclinkStore((s) => s.error)
  const authUser = useAuthStore((s) => s.user)
  const loggedIn = useAuthStore((s) => s.loggedIn)
  const load = useCclinkStore((s) => s.load)
  const preflightLegacyImport = useCclinkStore((s) => s.preflightLegacyImport)
  const ensureIdentity = useCclinkStore((s) => s.ensureIdentity)
  const sendLegacySmsCode = useCclinkStore((s) => s.sendLegacySmsCode)
  const importLegacyIdentity = useCclinkStore((s) => s.importLegacyIdentity)
  const clearIdentity = useCclinkStore((s) => s.clearIdentity)
  const syncPairedAgents = useCclinkStore((s) => s.syncPairedAgents)
  const connectRealtime = useCclinkStore((s) => s.connectRealtime)
  const disconnectRealtime = useCclinkStore((s) => s.disconnectRealtime)
  const seedDemoData = useCclinkStore((s) => s.seedDemoData)
  const clearLocalData = useCclinkStore((s) => s.clearLocalData)
  const [legacySmsCode, setLegacySmsCode] = useState('')
  const [legacySmsSent, setLegacySmsSent] = useState(false)
  const cachedPhone = loggedIn ? authUser?.phone : null
  const verifiedLegacyPhone = legacyPreflight?.ok
    ? (legacyPreflight.cloudUser?.phone ?? null)
    : null
  const canUseLegacyImport = Boolean(legacyPreflight?.ok && verifiedLegacyPhone)

  useEffect(() => {
    void load()
  }, [load])

  const handleSendLegacySmsCode = async (): Promise<void> => {
    const preflight = await preflightLegacyImport()
    if (!preflight?.ok) {
      useCclinkStore.setState({
        error: preflight?.message ?? '旧 CCLink 导入预检失败。',
      })
      return
    }
    if (identity) {
      await clearIdentity()
    }
    await sendLegacySmsCode()
    setLegacySmsSent(true)
  }

  const handleImportLegacyIdentity = async (): Promise<void> => {
    const preflight = legacyPreflight?.ok ? legacyPreflight : await preflightLegacyImport()
    if (!preflight?.ok) {
      useCclinkStore.setState({
        error: preflight?.message ?? '旧 CCLink 导入预检失败。',
      })
      return
    }
    await importLegacyIdentity(legacySmsCode)
    setLegacySmsCode('')
    setLegacySmsSent(false)
  }

  return (
    <div className="cclink-panel">
      <div className="cclink-intro">
        <div className="cclink-intro-title">
          <IconLink size={14} />
          CCLink 远程连接
        </div>
        <p>
          DeepInk 通过 CCLink 连接 <code>chatcc-agent</code>
          ；这里只处理账号、链路、服务器同步和诊断。
        </p>
      </div>

      <div className={`cclink-identity-card ${identity ? 'ready' : ''}`}>
        <div className="cclink-identity-main">
          <div className="cclink-identity-title">
            {identity ? '账户身份已同步' : '账户身份未同步'}
          </div>
          <div className="cclink-identity-detail">
            {identity
              ? `${identity.clientImUserId} · SDKAppID ${identity.sdkAppId}`
              : cachedPhone
                ? '没有旧 CCLink 服务器时可创建 DeepInk 新身份；已有旧服务器请用下方“导入旧 CCLink 账号”。'
                : loggedIn
                  ? '当前 DeepInk 账号没有手机号，无法创建或导入 CCLink 身份。'
                  : '当前为本机工作台模式；登录 DeepInk 云账号后可创建或导入 CCLink 身份。'}
          </div>
        </div>
        <div className="cclink-identity-actions">
          <button
            className="cclink-btn primary"
            onClick={() => void ensureIdentity()}
            disabled={identityLoading || !cachedPhone}
          >
            {identityLoading ? '处理中' : '创建 DeepInk 身份'}
          </button>
          {identity && (
            <button
              className="cclink-btn"
              onClick={() => void clearIdentity()}
              disabled={identityLoading}
            >
              移除
            </button>
          )}
        </div>
      </div>

      <div className="cclink-legacy-card">
        <div className="cclink-legacy-title">导入旧 CCLink 账号</div>
        <div className="cclink-legacy-hint">
          {verifiedLegacyPhone
            ? `云端预检确认当前 token 手机号为 ${verifiedLegacyPhone}；发送验证码前如已有本地身份，会先自动移除。`
            : cachedPhone
              ? `本地缓存手机号为 ${cachedPhone}；发送验证码前会先向云端 /auth/me 复核。`
              : loggedIn
                ? '当前 DeepInk 账号没有手机号，需先用旧 CCLink 手机号登录 DeepInk。'
                : '需先登录 DeepInk 云账号，再导入旧 CCLink 账号。'}
        </div>
        <div
          className={`cclink-preflight ${legacyPreflight?.ok ? 'ready' : legacyPreflight ? 'blocked' : ''}`}
        >
          <div className="cclink-preflight-title">
            旧账号导入预检：
            {preflightLoading
              ? '检查中'
              : legacyPreflight
                ? legacyPreflight.ok
                  ? '通过'
                  : '未通过'
                : '未检查'}
          </div>
          <div className="cclink-preflight-detail">
            {legacyPreflight?.message ??
              '不会发送短信、不会创建身份、不会改云端；只确认当前 token 对应的云端账号。'}
          </div>
          {legacyPreflight && (
            <div className="cclink-preflight-meta">
              <span>缓存：{legacyPreflight.cachedUser?.phone ?? '无手机号'}</span>
              <span>云端：{legacyPreflight.cloudUser?.phone ?? '无手机号'}</span>
              <span>版本：{legacyPreflight.cloudVersion?.version ?? '未知'}</span>
            </div>
          )}
        </div>
        <div className="cclink-legacy-actions">
          <button
            className="cclink-btn"
            onClick={() => void preflightLegacyImport()}
            disabled={preflightLoading || identityLoading || !loggedIn}
          >
            {preflightLoading ? '检查中' : '预检'}
          </button>
          <button
            className="cclink-btn"
            onClick={() => void handleSendLegacySmsCode()}
            disabled={identityLoading || preflightLoading || (!cachedPhone && !verifiedLegacyPhone)}
          >
            {legacySmsSent ? '重新发送验证码' : '预检并发送验证码'}
          </button>
          <input
            className="cclink-legacy-input"
            value={legacySmsCode}
            onChange={(event) => setLegacySmsCode(event.target.value)}
            placeholder="旧 CCLink 验证码"
            inputMode="numeric"
          />
          <button
            className="cclink-btn primary"
            onClick={() => void handleImportLegacyIdentity()}
            disabled={
              identityLoading ||
              preflightLoading ||
              !canUseLegacyImport ||
              legacySmsCode.trim().length === 0
            }
          >
            导入
          </button>
        </div>
      </div>

      <div className={`cclink-identity-card ${realtimeStatus.state === 'online' ? 'ready' : ''}`}>
        <div className="cclink-identity-main">
          <div className="cclink-identity-title">{realtimeStatusLabel(realtimeStatus.state)}</div>
          <div className="cclink-identity-detail">
            {realtimeStatus.error ||
              (identity
                ? '使用当前 CCLink/TIM 身份连接远程设备。'
                : '请先创建 DeepInk 身份，或导入旧 CCLink 账号。')}
          </div>
        </div>
        <div className="cclink-identity-actions">
          {realtimeStatus.state === 'online' ? (
            <button
              className="cclink-btn"
              onClick={() => void disconnectRealtime()}
              disabled={realtimeLoading}
            >
              {realtimeLoading ? '断开中' : '断开'}
            </button>
          ) : (
            <button
              className="cclink-btn primary"
              onClick={() => void connectRealtime()}
              disabled={realtimeLoading || !identity}
            >
              {realtimeLoading ? '连接中' : '连接实时链路'}
            </button>
          )}
        </div>
      </div>

      <div className="cclink-actions">
        <button
          className="cclink-btn primary"
          onClick={() => void seedDemoData()}
          disabled={loading}
        >
          生成示例数据
        </button>
        <button
          className="cclink-btn"
          onClick={() => void syncPairedAgents()}
          disabled={loading || !identity}
        >
          同步服务器
        </button>
        <button
          className="cclink-btn danger"
          onClick={() => void clearLocalData()}
          disabled={loading}
        >
          清空
        </button>
      </div>

      {error && <div className="cclink-error">{error}</div>}

      {servers.length === 0 && !loading && (
        <div className="cclink-empty">
          <IconRobot size={22} />
          <div className="cclink-empty-title">还没有同步远程设备</div>
          <div className="cclink-empty-hint">
            下一步接入 Setup Code 配对，把 chatcc-agent 绑定到当前账号。
          </div>
        </div>
      )}

      {servers.length > 0 && (
        <>
          <div className="sidebar-section">
            <div className="sidebar-section-header expanded">
              <IconChevronDown size={10} />
              远程设备
            </div>
            {servers.map((server) => (
              <ServerItem key={server.id} server={server} />
            ))}
          </div>

          <div className="cclink-preview">
            <div className="cclink-preview-title">会话已迁入工作空间</div>
            <div className="cclink-preview-path">
              远程会话和文件显示在对应的远程工作空间下；设置页只负责连接和诊断。
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ServerItem({ server }: { server: ChatccServer }): React.ReactElement {
  return (
    <div className="cclink-server">
      <div className="cclink-server-head">
        <span className={`cclink-status ${server.status}`} />
        <span className="cclink-server-name">{server.name}</span>
        <span className="cclink-server-state">{serverStatusLabel(server.status)}</span>
      </div>
      <div className="cclink-server-meta">
        {server.hostname} · {server.os}
      </div>
      <div className="cclink-workspaces">
        {server.workspaces.map((workspace) => (
          <div key={workspace.id} className="cclink-workspace">
            {workspace.sessionCount > 0 ? <IconFolder size={13} /> : <IconFile size={13} />}
            <span>{workspace.name}</span>
            <span className="cclink-workspace-count">{workspace.sessionCount}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
