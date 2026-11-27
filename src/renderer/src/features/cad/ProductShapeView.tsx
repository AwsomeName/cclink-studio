import { useEffect, useState } from 'react'
import { shapeRevision, type ShapeRevision } from '@shared/cad/product-shape'
import { ModelViewer } from '../../components/workbench/ModelViewer'
import { useAgentStore, useUIStore, useWorkspaceStore } from '../../stores'
import { createConversationRuntimeForWorkspace } from '../agent-conversations/view-model'
import { createConversationRunController } from '../agent-conversations/conversation-run-controller'
import './product-shape.css'

export function isProductShapeModel(path: string): boolean {
  return /\/产品造型\/[\da-f-]{36}\/shape\.glb$/i.test(path.replaceAll('\\', '/'))
}

function Outline({
  revision,
  edge,
  target,
}: {
  revision: ShapeRevision
  edge: number
  target: number
}) {
  const points = revision.points
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1])
  const xmin = Math.min(...xs),
    ymax = Math.max(...ys)
  const scale = Math.min(220 / (Math.max(...xs) - xmin), 120 / (ymax - Math.min(...ys)))
  const xy = points.map(([x, y]) => [20 + (x - xmin) * scale, 20 + (ymax - y) * scale])
  return (
    <svg
      className="shape-outline"
      viewBox="0 0 264 162"
      aria-label="俯视轮廓，绿色为锁定边，橙色为修改顶点"
    >
      <polygon
        points={xy.map((p) => p.join(',')).join(' ')}
        fill="#304955"
        stroke="#91b5cd"
        strokeWidth="2"
      />
      <line
        x1={xy[edge][0]}
        y1={xy[edge][1]}
        x2={xy[(edge + 1) % xy.length][0]}
        y2={xy[(edge + 1) % xy.length][1]}
        stroke="#77dfbe"
        strokeWidth="5"
      />
      {xy.map(([x, y], i) => (
        <g key={i}>
          <circle
            cx={x}
            cy={y}
            r={i === target ? 5 : 3}
            fill={i === target ? '#ffb071' : '#deedf6'}
          />
          <text x={x + 3} y={y - 5} fill="white" fontSize={11}>
            {i}
          </text>
        </g>
      ))}
    </svg>
  )
}

export function ProductShapeView({ filePath }: { filePath?: string }) {
  const [revision, setRevision] = useState<ShapeRevision | null>(null)
  const [brief, setBrief] = useState('')
  const [edge, setEdge] = useState(0),
    [target, setTarget] = useState(2)
  const [wall, setWall] = useState('2'),
    [floor, setFloor] = useState('2')
  const [message, setMessage] = useState(''),
    [sending, setSending] = useState(false)
  useEffect(() => {
    let alive = true
    if (filePath)
      void window.cclinkStudio.fs
        .readFile(filePath.replace(/shape\.glb$/, 'revision.json'))
        .then((file) => {
          const doc = shapeRevision.parse(JSON.parse(file.content))
          if (!filePath.endsWith('/' + doc.id + '/shape.glb')) throw Error('版本 ID 不匹配')
          if (alive) {
            setRevision(doc)
            setEdge(doc.lockedEdge ?? 0)
            setTarget(doc.targetVertex ?? 2)
          }
        })
        .catch((e) => {
          if (alive) setMessage('无法读取造型记录：' + String(e))
        })
    return () => {
      alive = false
    }
  }, [filePath])
  async function send(tool: string, request: string) {
    const ref = useWorkspaceStore.getState().activeWorkspaceRef
    if (sending || ref.kind !== 'local') return
    setSending(true)
    setMessage('')
    try {
      const store = useAgentStore.getState()
      const binding = store.conversations[store.activeConversationId]?.runtimeBinding
      const id = store.createConversation({
        runtime: createConversationRuntimeForWorkspace(ref),
        runtimeBinding: binding?.kind === 'acp' ? undefined : binding,
        activate: true,
      })
      useUIStore.getState().setAgentContentMode('chat')
      useUIStore.getState().setAgentPanelMode('right', 'user')
      const result = await createConversationRunController({ conversationId: id }).send(
        '这是 Studio 的产品造型操作。请使用本地 MCP 工具 ' +
          tool +
          ' 完成以下要求，只调用该造型工具。生成结果只依据工具真实回执。不能表达的硬要求请说明或询问我。\n' +
          request,
      )
      if (result.status !== 'accepted')
        throw Error(result.status === 'failed' ? result.error : '未启动本次造型操作')
      setMessage('已交给 Agent，请在右侧核对工具参数并确认。')
    } catch (e) {
      setMessage(String(e))
    } finally {
      setSending(false)
    }
  }
  if (!filePath)
    return (
      <section className="product-shape shape-start">
        <h2>新建产品造型</h2>
        <p>
          描述一款直壁单件外壳。给出俯视轮廓、长宽和高度，Blender 将生成可继续修改的外形。当前支持
          3–16 个角的凸多边形。
        </p>
        <label>
          我的外形描述
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            maxLength={2600}
            rows={4}
          />
        </label>
        <button
          disabled={sending || !brief.trim()}
          onClick={() =>
            void send(
              'cad_create_shape',
              '请按我的原话设计毫米制 XY 轮廓和 Z 高度，顶点逆时针排序；brief 保留我的原话。\n' +
                brief,
            )
          }
        >
          用 Blender 生成一款外形
        </button>
        <p role="status">{message}</p>
      </section>
    )
  const n = revision?.points.length ?? 0
  return (
    <div className="shape-workspace">
      <ModelViewer filePath={filePath} />
      <section className="product-shape shape-inspector">
        <h3>{revision?.parentId ? '子版外形' : '外形与尺寸'}</h3>
        {revision && (
          <>
            <p>{revision.brief}</p>
            <small>
              版本 {revision.id.slice(0, 8)}
              {revision.parentId ? '　父版 ' + revision.parentId.slice(0, 8) : ''}　·　高{' '}
              {revision.heightMm} mm
            </small>
            <Outline revision={revision} edge={edge} target={target} />
            <label>
              锁定侧面
              <select
                value={edge}
                disabled={revision.lockedEdge !== null}
                onChange={(e) => {
                  const next = Number(e.target.value)
                  setEdge(next)
                  if (target === next || target === (next + 1) % n) setTarget((next + 2) % n)
                }}
              >
                {revision.points.map((_, i) => (
                  <option key={i} value={i}>
                    边 {i}（点 {i} → {(i + 1) % n}）
                  </option>
                ))}
              </select>
            </label>
            <label>
              修改顶点
              <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
                {revision.points.map(([x, y], i) => (
                  <option key={i} disabled={i === edge || i === (edge + 1) % n} value={i}>
                    点 {i}　({x}, {y}) mm
                  </option>
                ))}
              </select>
            </label>
            <label>
              怎样改这里
              <textarea
                rows={2}
                maxLength={2000}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
              />
            </label>
            <button
              disabled={sending || !brief.trim()}
              onClick={() =>
                void send(
                  'cad_revise_shape',
                  JSON.stringify({
                    sourceId: revision.id,
                    lockedEdge: edge,
                    targetVertex: target,
                    currentPointsMm: revision.points,
                    requirement: brief,
                  }) + '。编号从 0 开始，按所选部位计算目标坐标，不得改变锁定侧面或替换源版本。',
                )
              }
            >
              锁住侧面，生成子版
            </button>
            {revision.parentId && (
              <>
                <hr />
                <p>
                  锁定面最大偏差 {revision.lockedFaceDeviationMm} mm。点 {revision.targetVertex} 从
                  ({revision.targetBeforeMm?.join(', ')}) 移至 ({revision.targetAfterMm?.join(', ')}
                  ) mm。
                </p>
                <h3>子版做结构</h3>
                <small>沿 +Z 开口。两侧壁均向内偏置。</small>
                <div className="shape-inputs">
                  <label>
                    壁厚 mm
                    <input
                      type="number"
                      min="0.1"
                      step=".1"
                      value={wall}
                      onChange={(e) => setWall(e.target.value)}
                    />
                  </label>
                  <label>
                    底厚 mm
                    <input
                      type="number"
                      min="0.1"
                      step=".1"
                      value={floor}
                      onChange={(e) => setFloor(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  disabled={
                    sending ||
                    +wall < 0.1 ||
                    +wall > 250 ||
                    +floor < 0.1 ||
                    +floor >= revision.heightMm ||
                    +floor > 250
                  }
                  onClick={() =>
                    void send(
                      'cad_shell_shape',
                      JSON.stringify({
                        sourceId: revision.id,
                        wallMm: Number(wall),
                        floorMm: Number(floor),
                      }) + '。只允许使用这个子版，回报 STEP 回读测量和工程文件路径。',
                    )
                  }
                >
                  用此子版生成 FreeCAD 和 STEP
                </button>
              </>
            )}
          </>
        )}
        <p role="status">{message}</p>
      </section>
    </div>
  )
}
