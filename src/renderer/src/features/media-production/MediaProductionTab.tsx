import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  MediaAspectRatio,
  MediaImageProviderStatus,
  MediaProject,
  MediaProjectAsset,
  MediaProjectPlatform,
  MediaProjectScene,
  MediaSearchCandidate,
  MediaStoryboardProposal,
} from '@shared/media-production/media-project-types'
import type { Tab } from '../../types'
import type {
  MediaVideoProviderStatus,
  MediaVideoTask,
} from '@shared/media-production/video-generation-types'
import type {
  MediaRenderRuntimeStatus,
  MediaRenderTask,
} from '@shared/media-production/media-render-types'
import { useCommandStore } from '../../stores/command-store'
import { useTabStore } from '../../stores/tab-store'
import { useToastStore } from '../../components/common/Toast'
import { registerMediaProjectDraft } from './media-project-draft-registry'
import {
  MEDIA_WORKFLOW_STAGES,
  MediaAudioPanel,
  MediaScriptPanel,
  type MediaWorkflowStage,
} from './MediaWorkflowPanels'
import './media-production.css'
import { VideoCreationWorkspace } from './VideoCreationWorkspace'

interface AssetPreview {
  url: string
  kind: 'image' | 'video'
}

const PLATFORM_LABELS: Record<MediaProjectPlatform, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  'wechat-video': '视频号',
  bilibili: 'B 站',
  web: '官网',
}

export function MediaProductionTab({ tab }: { tab: Tab }): React.ReactElement {
  const [legacy, setLegacy] = useState(false)
  if (!legacy)
    return (
      <VideoCreationWorkspace
        key={`${tab.id}:${tab.mediaProject?.projectId}`}
        tab={tab}
        onLegacy={() => setLegacy(true)}
      />
    )
  return (
    <div className="media-legacy-container">
      <div className="media-legacy-banner">
        旧版工作台 · 与新版口播独立，修改分镜不会同步新版口播
        <button
          disabled={tab.dirty}
          title={tab.dirty ? '先保存旧版修改再返回' : undefined}
          onClick={() => setLegacy(false)}
        >
          返回口播创作
        </button>
      </div>
      <LegacyMediaProductionTab tab={tab} />
    </div>
  )
}

function LegacyMediaProductionTab({ tab }: { tab: Tab }): React.ReactElement {
  const projectId = tab.mediaProject?.projectId
  const workspacePath = tab.workspaceRef?.kind === 'local' ? tab.workspaceRef.path : null
  const [project, setProject] = useState<MediaProject | null>(null)
  const [draft, setDraft] = useState<MediaProject | null>(null)
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generatingStoryboard, setGeneratingStoryboard] = useState(false)
  const [storyboardProposal, setStoryboardProposal] = useState<MediaStoryboardProposal | null>(null)
  const [assetPreview, setAssetPreview] = useState<AssetPreview | null>(null)
  const [renderPreview, setRenderPreview] = useState<AssetPreview | null>(null)
  const [imageProviders, setImageProviders] = useState<MediaImageProviderStatus[]>([])
  const [imageProviderId, setImageProviderId] = useState<'meshy' | 'jimeng'>('jimeng')
  const [generatingImage, setGeneratingImage] = useState(false)
  const [assetSearchQuery, setAssetSearchQuery] = useState('')
  const [assetSearchKind, setAssetSearchKind] = useState<'image' | 'video'>('image')
  const [assetSearchResults, setAssetSearchResults] = useState<MediaSearchCandidate[]>([])
  const [searchingAssets, setSearchingAssets] = useState(false)
  const [addingCandidateId, setAddingCandidateId] = useState<string | null>(null)
  const [videoProviders, setVideoProviders] = useState<MediaVideoProviderStatus[]>([])
  const [videoTasks, setVideoTasks] = useState<MediaVideoTask[]>([])
  const [videoDuration, setVideoDuration] = useState<5 | 10>(5)
  const [submittingVideo, setSubmittingVideo] = useState(false)
  const [renderRuntime, setRenderRuntime] = useState<MediaRenderRuntimeStatus | null>(null)
  const [renderTasks, setRenderTasks] = useState<MediaRenderTask[]>([])
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<MediaWorkflowStage>('script')
  const [materialSource, setMaterialSource] = useState<'local' | 'search' | 'generate'>('local')
  const updateTabDirty = useTabStore((state) => state.updateTabDirty)
  const updateTabTitle = useTabStore((state) => state.updateTabTitle)
  const executeCommand = useCommandStore((state) => state.executeCommand)
  const showToast = useToastStore((state) => state.show)

  useEffect(() => {
    if (!workspacePath || !projectId) {
      setError('宣发视频工程引用无效')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void window.cclinkStudio.mediaProjects.get(workspacePath, projectId).then((result) => {
      if (cancelled) return
      if (!result.success) {
        setError(result.error.message)
        setLoading(false)
        return
      }
      setProject(result.project)
      setDraft(result.project)
      setSelectedSceneId(result.project.scenes[0]?.id ?? null)
      setError(null)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, workspacePath])

  useEffect(() => {
    let cancelled = false
    void window.cclinkStudio.mediaProjects.getImageProviders().then((result) => {
      if (cancelled || !result.success) return
      setImageProviders(result.providers)
      const preferred = result.providers.find((provider) => provider.configured)
      if (preferred) setImageProviderId(preferred.id)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void window.cclinkStudio.mediaVideo.getProviders().then((result) => {
      if (result.success) setVideoProviders(result.providers)
    })
    void window.cclinkStudio.mediaRender
      .getRuntimeStatus()
      .then((result) => {
        if (result.success) setRenderRuntime(result.runtime)
        else
          setRenderRuntime({
            available: false,
            version: null,
            source: 'unavailable',
            reason: result.error.message,
          })
      })
      .catch(() =>
        setRenderRuntime({
          available: false,
          version: null,
          source: 'unavailable',
          reason: '无法检查本地导出环境，请重新打开工程',
        }),
      )
  }, [])

  useEffect(() => {
    if (!workspacePath || !projectId) return
    let cancelled = false
    const refresh = async (): Promise<void> => {
      const [videoResult, renderResult] = await Promise.all([
        window.cclinkStudio.mediaVideo.listTasks(workspacePath, projectId),
        window.cclinkStudio.mediaRender.listTasks(workspacePath, projectId),
      ])
      if (cancelled) return
      if (videoResult.success) setVideoTasks(videoResult.tasks)
      if (renderResult.success) setRenderTasks(renderResult.tasks)
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 3_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [projectId, workspacePath])

  const save = useCallback(async (): Promise<boolean> => {
    if (!workspacePath || !project || !draft || saving) return false
    setSaving(true)
    try {
      const result = await window.cclinkStudio.mediaProjects.save({
        workspacePath,
        expectedRevision: project.revision,
        project: draft,
      })
      if (!result.success) {
        setError(result.error.message)
        showToast(result.error.message, 'error')
        return false
      }
      setProject(result.project)
      setDraft(result.project)
      updateTabDirty(tab.id, false)
      updateTabTitle(tab.id, result.project.title)
      setError(null)
      showToast('宣发视频工程已保存', 'success')
      return true
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : '宣发视频工程保存失败'
      setError(message)
      showToast(message, 'error')
      return false
    } finally {
      setSaving(false)
    }
  }, [draft, project, saving, showToast, tab.id, updateTabDirty, updateTabTitle, workspacePath])

  useEffect(() => {
    if (!project || !draft) return
    return registerMediaProjectDraft(tab.id, { save })
  }, [draft, project, save, tab.id])

  const mutate = useCallback(
    (recipe: (current: MediaProject) => MediaProject): void => {
      setDraft((current) => (current ? recipe(current) : current))
      setRenderPreview(null)
      updateTabDirty(tab.id, true)
    },
    [tab.id, updateTabDirty],
  )

  const selectedScene = useMemo(
    () => draft?.scenes.find((scene) => scene.id === selectedSceneId) ?? draft?.scenes[0] ?? null,
    [draft, selectedSceneId],
  )
  const selectedAsset = useMemo(
    () => draft?.assets?.find((asset) => asset.id === selectedScene?.assetId) ?? null,
    [draft?.assets, selectedScene?.assetId],
  )

  useEffect(() => {
    setAssetSearchQuery(selectedScene?.searchTerms.join(' ') ?? '')
    setAssetSearchResults([])
  }, [selectedScene?.id])

  useEffect(() => {
    if (!selectedAsset) {
      setAssetPreview(null)
      return
    }
    let cancelled = false
    void window.cclinkStudio.fs
      .renderFile(selectedAsset.path)
      .then((result) => {
        if (cancelled) return
        if (result.kind === 'image') {
          setAssetPreview({
            kind: 'image',
            url: `data:${result.mimeType};base64,${result.content}`,
          })
        } else if (
          result.kind === 'media' &&
          result.mediaKind === 'video' &&
          result.playable &&
          result.content &&
          result.mimeType
        ) {
          setAssetPreview({
            kind: 'video',
            url: `data:${result.mimeType};base64,${result.content}`,
          })
        } else {
          setAssetPreview(null)
        }
      })
      .catch(() => {
        if (!cancelled) setAssetPreview(null)
      })
    return () => {
      cancelled = true
    }
  }, [selectedAsset])

  const updateScene = (changes: Partial<MediaProjectScene>): void => {
    if (!selectedScene) return
    mutate((current) => ({
      ...current,
      scenes: current.scenes.map((scene) =>
        scene.id === selectedScene.id ? { ...scene, ...changes } : scene,
      ),
    }))
  }

  const moveScene = (direction: -1 | 1): void => {
    if (!draft || !selectedScene) return
    const index = draft.scenes.findIndex((scene) => scene.id === selectedScene.id)
    const target = index + direction
    if (target < 0 || target >= draft.scenes.length) return
    mutate((current) => {
      const scenes = [...current.scenes]
      const [moved] = scenes.splice(index, 1)
      scenes.splice(target, 0, moved)
      return { ...current, scenes: scenes.map((scene, order) => ({ ...scene, order })) }
    })
  }

  const proposeStoryboard = async (): Promise<void> => {
    if (!workspacePath || !draft || generatingStoryboard) return
    setGeneratingStoryboard(true)
    setStoryboardProposal(null)
    try {
      const result = await window.cclinkStudio.mediaProjects.proposeStoryboard({
        workspacePath,
        project: draft,
      })
      if (!result.success) {
        setError(result.error.message)
        showToast(result.error.message, 'error')
        return
      }
      setStoryboardProposal(result.proposal)
      setError(null)
      showToast('智能分镜提案已生成，请审阅后应用', 'success')
    } catch (proposalError) {
      const message = proposalError instanceof Error ? proposalError.message : '智能分镜生成失败'
      setError(message)
      showToast(message, 'error')
    } finally {
      setGeneratingStoryboard(false)
    }
  }

  const applyStoryboardProposal = (): void => {
    if (!storyboardProposal) return
    mutate((current) => ({
      ...current,
      title: storyboardProposal.title,
      scenes: storyboardProposal.scenes,
    }))
    setSelectedSceneId(storyboardProposal.scenes[0]?.id ?? null)
    setStoryboardProposal(null)
    showToast('已应用智能分镜提案，保存工程后生效', 'success')
  }

  const importAsset = async (): Promise<void> => {
    if (!workspacePath || !projectId || !selectedScene) return
    const selected = await window.cclinkStudio.dialog.showOpenDialog({
      title: `为场景 ${selectedScene.order + 1} 导入素材`,
      filters: [
        {
          name: '图片与视频',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'webm', 'm4v'],
        },
      ],
    })
    const sourcePath = selected.filePaths[0]
    if (selected.canceled || !sourcePath) return
    const result = await window.cclinkStudio.mediaProjects.importAsset({
      workspacePath,
      projectId,
      sourcePath,
    })
    if (!result.success) {
      setError(result.error.message)
      showToast(result.error.message, 'error')
      return
    }
    mutate((current) => ({
      ...current,
      assets: appendAsset(current.assets ?? [], result.asset),
      scenes: current.scenes.map((scene) =>
        scene.id === selectedScene.id
          ? { ...scene, assetId: result.asset.id, materialKind: 'workspace' }
          : scene,
      ),
    }))
    setError(null)
    showToast('素材已复制到工程并绑定当前场景', 'success')
  }

  const importSupportingAsset = async (target: 'logo' | 'music' | 'narration'): Promise<void> => {
    if (!workspacePath || !projectId) return
    const selected = await window.cclinkStudio.dialog.showOpenDialog({
      title:
        target === 'logo'
          ? '导入品牌 Logo'
          : target === 'narration'
            ? '导入旁白音频'
            : '导入背景音乐',
      filters:
        target === 'logo'
          ? [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
          : [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }],
    })
    const sourcePath = selected.filePaths[0]
    if (selected.canceled || !sourcePath) return
    const result = await window.cclinkStudio.mediaProjects.importAsset({
      workspacePath,
      projectId,
      sourcePath,
    })
    if (!result.success) {
      showToast(result.error.message, 'error')
      return
    }
    mutate((current) => ({
      ...current,
      assets: appendAsset(current.assets ?? [], result.asset),
      renderSettings: {
        ...defaultRenderSettings(current),
        ...(target === 'logo'
          ? { logoAssetId: result.asset.id }
          : target === 'narration'
            ? { narrationAssetId: result.asset.id }
            : { musicAssetId: result.asset.id }),
      },
    }))
    showToast(
      target === 'logo'
        ? 'Logo 已加入成片设置'
        : target === 'narration'
          ? '旁白已加入成片设置'
          : '背景音乐已加入成片设置',
      'success',
    )
  }

  const generateSceneImage = async (): Promise<void> => {
    if (!workspacePath || !projectId || !selectedScene || generatingImage) return
    if (tab.dirty && !(await save())) return
    const provider = imageProviders.find((candidate) => candidate.id === imageProviderId)
    if (!provider?.configured) {
      showToast(provider?.reason || '请先在设置中配置图片 Provider', 'error')
      return
    }
    const confirmation = await window.cclinkStudio.dialog.showMessageBox({
      type: 'question',
      title: '确认生成场景图片',
      message: `使用 ${imageProviderId === 'jimeng' ? '即梦' : 'Meshy'} 生成 1 张图片？`,
      detail: '将上传当前场景提示词；费用由 Provider 账户结算，Studio 当前无法预估金额。',
      buttons: ['取消', '确认生成'],
      defaultId: 1,
      cancelId: 0,
    })
    if (confirmation.response !== 1) return
    setGeneratingImage(true)
    try {
      const result = await window.cclinkStudio.mediaProjects.generateSceneImage({
        workspacePath,
        projectId,
        sceneId: selectedScene.id,
        prompt: selectedScene.generationPrompt,
        aspectRatio: draft?.brief.aspectRatio ?? '16:9',
        provider: imageProviderId,
      })
      if (!result.success) {
        setError(result.error.message)
        showToast(result.error.message, 'error')
        return
      }
      mutate((current) => ({
        ...current,
        assets: appendAsset(current.assets ?? [], result.asset),
        scenes: current.scenes.map((scene) =>
          scene.id === selectedScene.id
            ? { ...scene, assetId: result.asset.id, materialKind: 'generated-image' }
            : scene,
        ),
      }))
      setError(null)
      showToast('场景图片已生成并加入工程', 'success')
    } finally {
      setGeneratingImage(false)
    }
  }

  const searchAssets = async (): Promise<void> => {
    if (!draft || !assetSearchQuery.trim() || searchingAssets) return
    setSearchingAssets(true)
    try {
      const result = await window.cclinkStudio.mediaProjects.searchAssets({
        query: assetSearchQuery,
        kind: assetSearchKind,
        orientation: draft.brief.aspectRatio,
        page: 1,
      })
      if (!result.success) {
        setAssetSearchResults([])
        showToast(result.error.message, 'error')
        return
      }
      setAssetSearchResults(result.candidates)
    } finally {
      setSearchingAssets(false)
    }
  }

  const addSearchCandidate = async (candidate: MediaSearchCandidate): Promise<void> => {
    if (!workspacePath || !projectId || !selectedScene || addingCandidateId) return
    setAddingCandidateId(candidate.id)
    try {
      const result = await window.cclinkStudio.mediaProjects.addSearchCandidate({
        workspacePath,
        projectId,
        candidateId: candidate.id,
      })
      if (!result.success) {
        showToast(result.error.message, 'error')
        return
      }
      mutate((current) => ({
        ...current,
        assets: appendAsset(current.assets ?? [], result.asset),
        scenes: current.scenes.map((scene) =>
          scene.id === selectedScene.id
            ? { ...scene, assetId: result.asset.id, materialKind: 'search' }
            : scene,
        ),
      }))
      showToast('搜索素材已下载、记录来源并绑定当前场景', 'success')
    } finally {
      setAddingCandidateId(null)
    }
  }

  const createVideoTask = async (): Promise<void> => {
    if (!workspacePath || !projectId || !project || !selectedScene || submittingVideo) return
    const provider = videoProviders.find((candidate) => candidate.id === 'volcengine-jimeng-video')
    if (!provider?.configured) {
      showToast(provider?.reason || '请先配置即梦视频 AK/SK', 'error')
      return
    }
    const wasDirty = tab.dirty
    if (wasDirty && !(await save())) return
    const projectRevision = wasDirty ? project.revision + 1 : project.revision
    const confirmation = await window.cclinkStudio.dialog.showMessageBox({
      type: 'warning',
      title: '确认付费视频生成',
      message: `使用即梦视频 3.0 Pro 生成 ${videoDuration} 秒视频？`,
      detail: `场景：${selectedScene.order + 1}\n画幅：${draft?.brief.aspectRatio}\n上传：当前场景提示词（不上传本地素材）\n费用：Provider 暂不提供可查询估价，将按你的火山引擎账户实际结算。`,
      buttons: ['取消', '确认付费生成'],
      defaultId: 0,
      cancelId: 0,
    })
    if (confirmation.response !== 1) return
    setSubmittingVideo(true)
    try {
      const result = await window.cclinkStudio.mediaVideo.createTask({
        workspacePath,
        projectId,
        projectRevision,
        sceneId: selectedScene.id,
        provider: 'volcengine-jimeng-video',
        model: 'jimeng-video-3.0-pro',
        prompt: selectedScene.generationPrompt,
        aspectRatio: draft?.brief.aspectRatio ?? '16:9',
        durationSeconds: videoDuration,
      })
      if (!result.success) {
        showToast(result.error.message, 'error')
        return
      }
      setVideoTasks((current) => [result.task, ...current])
      showToast('即梦视频任务已提交，可关闭 Tab 后继续运行', 'success')
    } finally {
      setSubmittingVideo(false)
    }
  }

  const adoptVideoTask = (task: MediaVideoTask): void => {
    if (!task.outputAsset) return
    mutate((current) => ({
      ...current,
      assets: current.assets?.some((asset) => asset.id === task.outputAsset?.id)
        ? current.assets
        : [...(current.assets ?? []), task.outputAsset!],
      scenes: current.scenes.map((scene) =>
        scene.id === task.sceneId
          ? { ...scene, assetId: task.outputAsset!.id, materialKind: 'generated-video' }
          : scene,
      ),
    }))
    showToast('生成视频已采用到对应场景，请保存工程', 'success')
  }

  const retryVideoTask = async (task: MediaVideoTask): Promise<void> => {
    if (!workspacePath) return
    const confirmation = await window.cclinkStudio.dialog.showMessageBox({
      type: 'warning',
      title: '确认重试付费视频生成',
      message: `再次使用即梦视频 3.0 Pro 生成 ${task.durationSeconds} 秒视频？`,
      detail: '重试会创建新的付费任务，并再次上传该任务记录的提示词。费用仍由火山引擎账户结算。',
      buttons: ['取消', '确认付费重试'],
      defaultId: 0,
      cancelId: 0,
    })
    if (confirmation.response !== 1) return
    const result = await window.cclinkStudio.mediaVideo.retryTask(workspacePath, task.id)
    if (!result.success) {
      showToast(result.error.message, 'error')
      return
    }
    setVideoTasks((current) => [result.task, ...current])
    showToast('已提交新的单场景视频任务', 'success')
  }

  const exportVideo = async (): Promise<void> => {
    if (!workspacePath || !projectId || !project || !draft || exporting) return
    if (!renderRuntime?.available) {
      showToast(renderRuntime?.reason || '未检测到可用 FFmpeg，当前不能导出 MP4', 'error')
      return
    }
    if (missingVisualAssets(draft).length > 0) {
      showToast('请先为每个场景选择图片或视频素材', 'error')
      return
    }
    const wasDirty = tab.dirty
    if (wasDirty && !(await save())) return
    const selection = await window.cclinkStudio.dialog.showSaveDialog({
      title: '导出宣发视频',
      defaultPath: `${safeFileName(draft.title)}.mp4`,
      filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
    })
    if (selection.canceled || !selection.filePath) return
    setExporting(true)
    try {
      const result = await window.cclinkStudio.mediaRender.createTask({
        workspacePath,
        projectId,
        projectRevision: wasDirty ? project.revision + 1 : project.revision,
        outputPath: selection.filePath,
      })
      if (!result.success) {
        showToast(result.error.message, 'error')
        return
      }
      setRenderTasks((current) => [result.task, ...current])
      showToast('成片导出已开始，可在任务抽屉查看步骤', 'success')
    } finally {
      setExporting(false)
    }
  }

  const retryRenderTask = async (task: MediaRenderTask): Promise<void> => {
    if (!workspacePath) return
    const result = await window.cclinkStudio.mediaRender.retryTask(workspacePath, task.id)
    if (!result.success) {
      showToast(result.error.message, 'error')
      return
    }
    setRenderTasks((current) => [result.task, ...current])
    showToast('已重新开始本地导出', 'success')
  }

  const previewRenderTask = async (task: MediaRenderTask): Promise<void> => {
    try {
      const result = await window.cclinkStudio.fs.renderFile(task.outputPath)
      if (
        result.kind === 'media' &&
        result.mediaKind === 'video' &&
        result.playable &&
        result.content &&
        result.mimeType
      ) {
        setRenderPreview({
          kind: 'video',
          url: `data:${result.mimeType};base64,${result.content}`,
        })
        setStage('export')
        return
      }
      showToast(
        result.kind === 'media' ? result.reason || '成片无法内嵌预览' : '成片格式无效',
        'error',
      )
    } catch (previewError) {
      showToast(previewError instanceof Error ? previewError.message : '成片预览失败', 'error')
    }
  }

  if (loading) return <div className="media-production-state">正在打开宣发视频工程…</div>
  if (!draft) {
    return (
      <div className="media-production-state error">
        <strong>无法打开宣发视频工程</strong>
        <span>{error ?? '工程内容不存在'}</span>
      </div>
    )
  }

  const totalDuration = draft.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0)
  const missingMaterialCount = missingVisualAssets(draft).length
  const activeStageIndex = MEDIA_WORKFLOW_STAGES.findIndex((item) => item.id === stage)
  const latestRender = renderTasks.find((task) => task.status === 'succeeded')
  const videoProvider = videoProviders.find((provider) => provider.id === 'volcengine-jimeng-video')
  const visualCounts = draft.scenes.reduce(
    (counts, scene) => {
      const asset = draft.assets?.find((item) => item.id === scene.assetId)
      if (asset?.kind === 'image') counts.images++
      if (asset?.kind === 'video') counts.videos++
      return counts
    },
    { images: 0, videos: 0 },
  )

  return (
    <div className={`media-production-workbench media-workflow-${stage}`}>
      <header className="media-production-header">
        <div>
          <div className="media-production-eyebrow">
            宣发视频工作台 · {draft.brief.aspectRatio} · {PLATFORM_LABELS[draft.brief.platform]}
          </div>
          <input
            className="media-production-title-input"
            value={draft.title}
            aria-label="工程标题"
            onChange={(event) => mutate((current) => ({ ...current, title: event.target.value }))}
          />
        </div>
        <div className="media-production-actions">
          <span>
            {draft.scenes.length} 个场景 · {totalDuration.toFixed(1)} 秒 ·{' '}
            {missingMaterialCount ? `${missingMaterialCount} 个素材缺口` : '素材已齐'}
          </span>
          <button
            type="button"
            className="secondary"
            disabled={generatingStoryboard || saving}
            title="使用当前 Agent 生成一次分镜提案，可能产生模型用量"
            onClick={() => void proposeStoryboard()}
          >
            {generatingStoryboard ? 'Agent 策划中…' : 'AI 生成分镜'}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={exporting || renderRuntime?.available !== true}
            title={
              renderRuntime?.available ? '导出 MP4、SRT 和素材来源清单' : renderRuntime?.reason
            }
            onClick={() => void exportVideo()}
          >
            {exporting ? '准备导出…' : '导出成片'}
          </button>
          <button
            type="button"
            disabled={!tab.dirty || saving}
            onClick={() => void executeCommand('workbench.save', { source: 'toolbar' })}
          >
            {saving ? '保存中…' : tab.dirty ? '保存工程' : '已保存'}
          </button>
        </div>
      </header>

      <nav className="media-production-stage-bar" aria-label="制作阶段">
        {MEDIA_WORKFLOW_STAGES.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={stage === item.id ? 'active' : ''}
            aria-current={stage === item.id ? 'step' : undefined}
            onClick={() => setStage(item.id)}
          >
            <b>{String(index + 1).padStart(2, '0')}</b>
            <span>
              {item.label}
              <small>{item.description}</small>
            </span>
          </button>
        ))}
      </nav>

      {storyboardProposal && (
        <section className="media-storyboard-proposal" aria-label="智能分镜提案">
          <div>
            <strong>智能分镜提案</strong>
            <span>
              标题“{draft.title}”→“{storyboardProposal.title}”；{draft.scenes.length} 个场景 →{' '}
              {storyboardProposal.scenes.length} 个场景；
              {draft.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0).toFixed(1)} 秒 →{' '}
              {storyboardProposal.scenes
                .reduce((sum, scene) => sum + scene.durationSeconds, 0)
                .toFixed(1)}{' '}
              秒
            </span>
            <small>{storyboardProposal.scenes.map((scene) => scene.subtitle).join(' / ')}</small>
          </div>
          <span className="media-storyboard-proposal-actions">
            <button type="button" onClick={() => setStoryboardProposal(null)}>
              放弃
            </button>
            <button type="button" className="primary" onClick={applyStoryboardProposal}>
              应用提案
            </button>
          </span>
        </section>
      )}

      {error && <div className="media-production-inline-error">{error}</div>}

      {stage === 'script' && (
        <MediaScriptPanel
          draft={draft}
          mutate={mutate}
          selectScene={(id) => {
            setSelectedSceneId(id)
            setStage('scenes')
            setRenderPreview(null)
          }}
        />
      )}
      {stage === 'audio' && (
        <MediaAudioPanel draft={draft} mutate={mutate} importAudio={importSupportingAsset} />
      )}

      {(stage === 'scenes' || stage === 'export') && (
        <div className="media-production-layout">
          {stage === 'scenes' && (
            <aside className="media-scene-list" aria-label="场景列表">
              {draft.scenes.map((scene, index) => (
                <button
                  type="button"
                  key={scene.id}
                  className={scene.id === selectedScene?.id ? 'active' : ''}
                  onClick={() => {
                    setRenderPreview(null)
                    setSelectedSceneId(scene.id)
                  }}
                >
                  <span className="media-scene-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="media-scene-copy">
                    <strong>{scene.subtitle || '未命名场景'}</strong>
                    <small>
                      {scene.durationSeconds}s ·{' '}
                      {draft.assets?.find((asset) => asset.id === scene.assetId)?.kind === 'video'
                        ? '视频镜头'
                        : scene.assetId
                          ? '图片动效'
                          : '待选素材'}
                    </small>
                  </span>
                </button>
              ))}
            </aside>
          )}

          <main className="media-preview-panel">
            {stage === 'export' && (
              <div className="media-export-checks">
                <div className="media-section-heading">
                  <div>
                    <h2>检查整片，再导出</h2>
                    <p>
                      {totalDuration.toFixed(1)} 秒 · {visualCounts.videos} 段视频 ·{' '}
                      {visualCounts.images} 张图片
                    </p>
                  </div>
                </div>
                <p className={missingMaterialCount ? 'media-attention' : ''}>
                  {missingMaterialCount
                    ? `还有 ${missingMaterialCount} 个镜头没有素材`
                    : '全部镜头已选择素材'}{' '}
                  <button type="button" onClick={() => setStage('scenes')}>
                    检查镜头
                  </button>
                </p>
                <p>
                  {draft.renderSettings?.narrationAssetId ? '已添加旁白音频' : '未添加旁白音频'} ·{' '}
                  {draft.renderSettings?.musicAssetId ? '已添加背景音乐' : '未添加背景音乐'}{' '}
                  <button type="button" onClick={() => setStage('audio')}>
                    调整声音
                  </button>
                </p>
                <p>
                  {renderRuntime === null
                    ? '正在检查本地导出环境…'
                    : renderRuntime.available
                      ? '本地导出环境可用'
                      : renderRuntime.reason}
                </p>
                {visualCounts.videos === 0 && visualCounts.images > 0 && (
                  <p>
                    目前全部画面来自图片，成片将使用图片缩放动效。可返回分镜导入录屏或生成动态镜头。
                  </p>
                )}
                {latestRender && (
                  <button type="button" onClick={() => void previewRenderTask(latestRender)}>
                    播放最近成片
                    {tab.dirty || latestRender.projectRevision !== project?.revision
                      ? '（修改前版本）'
                      : ''}
                  </button>
                )}
              </div>
            )}
            <div
              className={`media-preview-frame ratio-${draft.brief.aspectRatio.replace(':', '-')}`}
              style={
                { '--media-brand-color': draft.brief.brand.primaryColor } as React.CSSProperties
              }
            >
              <div className="media-preview-orb" />
              {(renderPreview ?? assetPreview)?.kind === 'image' && (
                <img
                  className="media-preview-asset"
                  src={(renderPreview ?? assetPreview)!.url}
                  alt={selectedAsset?.fileName}
                />
              )}
              {(renderPreview ?? assetPreview)?.kind === 'video' && (
                <video
                  className="media-preview-asset"
                  src={(renderPreview ?? assetPreview)!.url}
                  controls
                  muted={!renderPreview}
                />
              )}
              {!renderPreview && !assetPreview && (
                <div className="media-preview-placeholder">
                  {selectedAsset ? selectedAsset.fileName : '素材待添加'}
                </div>
              )}
              {!renderPreview && (
                <div className="media-preview-subtitle">{selectedScene?.subtitle}</div>
              )}
            </div>
            <div className="media-preview-caption">
              {renderPreview
                ? '已导出文件预览 · 修改后需重新导出'
                : `场景 ${selectedScene ? selectedScene.order + 1 : 0} · 静态排版参考，最终动效与声音请导出后播放`}
            </div>
            {stage === 'export' && (
              <div className="media-brief-grid">
                <label>
                  平台
                  <select
                    value={draft.brief.platform}
                    onChange={(event) =>
                      mutate((current) => ({
                        ...current,
                        brief: {
                          ...current.brief,
                          platform: event.target.value as MediaProjectPlatform,
                        },
                      }))
                    }
                  >
                    {Object.entries(PLATFORM_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  画幅
                  <select
                    value={draft.brief.aspectRatio}
                    onChange={(event) =>
                      mutate((current) => ({
                        ...current,
                        brief: {
                          ...current.brief,
                          aspectRatio: event.target.value as MediaAspectRatio,
                        },
                      }))
                    }
                  >
                    <option value="9:16">9:16</option>
                    <option value="16:9">16:9</option>
                    <option value="1:1">1:1</option>
                  </select>
                </label>
                <label>
                  品牌色
                  <input
                    type="color"
                    value={draft.brief.brand.primaryColor}
                    onChange={(event) =>
                      mutate((current) => ({
                        ...current,
                        brief: {
                          ...current.brief,
                          brand: { ...current.brief.brand, primaryColor: event.target.value },
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  结尾 CTA
                  <input
                    value={draft.brief.brand.callToAction}
                    placeholder="例如：立即体验"
                    onChange={(event) =>
                      mutate((current) => ({
                        ...current,
                        brief: {
                          ...current.brief,
                          brand: { ...current.brief.brand, callToAction: event.target.value },
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  场景转场
                  <select
                    value={defaultRenderSettings(draft).transition}
                    onChange={(event) =>
                      mutate((current) => ({
                        ...current,
                        renderSettings: {
                          ...defaultRenderSettings(current),
                          transition: event.target.value as 'cut' | 'fade',
                        },
                      }))
                    }
                  >
                    <option value="cut">直接切换</option>
                    <option value="fade">淡入淡出</option>
                  </select>
                </label>
                <label>
                  品牌 Logo
                  <span className="media-supporting-asset-row">
                    <select
                      aria-label="品牌 Logo"
                      value={defaultRenderSettings(draft).logoAssetId ?? ''}
                      onChange={(event) =>
                        mutate((current) => ({
                          ...current,
                          renderSettings: {
                            ...defaultRenderSettings(current),
                            logoAssetId: event.target.value || null,
                          },
                        }))
                      }
                    >
                      <option value="">不添加</option>
                      {(draft.assets ?? [])
                        .filter((asset) => asset.kind === 'image')
                        .map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.fileName}
                          </option>
                        ))}
                    </select>
                    <button type="button" onClick={() => void importSupportingAsset('logo')}>
                      导入
                    </button>
                  </span>
                </label>
                <label>
                  背景音乐 · {Math.round(defaultRenderSettings(draft).musicVolume * 100)}%
                  <span className="media-supporting-asset-row">
                    <select
                      aria-label="背景音乐"
                      value={defaultRenderSettings(draft).musicAssetId ?? ''}
                      onChange={(event) =>
                        mutate((current) => ({
                          ...current,
                          renderSettings: {
                            ...defaultRenderSettings(current),
                            musicAssetId: event.target.value || null,
                          },
                        }))
                      }
                    >
                      <option value="">不添加</option>
                      {(draft.assets ?? [])
                        .filter((asset) => asset.kind === 'audio')
                        .map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.fileName}
                          </option>
                        ))}
                    </select>
                    <button type="button" onClick={() => void importSupportingAsset('music')}>
                      导入
                    </button>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={defaultRenderSettings(draft).musicVolume}
                    disabled={!defaultRenderSettings(draft).musicAssetId}
                    onChange={(event) =>
                      mutate((current) => ({
                        ...current,
                        renderSettings: {
                          ...defaultRenderSettings(current),
                          musicVolume: Number(event.target.value),
                        },
                      }))
                    }
                  />
                </label>
              </div>
            )}
          </main>

          {stage === 'scenes' && selectedScene && (
            <aside className="media-scene-inspector" aria-label="场景检查器">
              <div className="media-inspector-heading">
                <strong>场景 {selectedScene.order + 1}</strong>
                <span>
                  <button type="button" onClick={() => moveScene(-1)} aria-label="场景上移">
                    ↑
                  </button>
                  <button type="button" onClick={() => moveScene(1)} aria-label="场景下移">
                    ↓
                  </button>
                </span>
              </div>
              <label>
                时长（秒）
                <input
                  type="number"
                  min={1}
                  max={60}
                  step={0.5}
                  value={selectedScene.durationSeconds}
                  onChange={(event) => updateScene({ durationSeconds: Number(event.target.value) })}
                />
              </label>
              <label>
                旁白文案
                <textarea
                  value={selectedScene.narration}
                  onChange={(event) => updateScene({ narration: event.target.value })}
                />
              </label>
              <label>
                屏幕字幕
                <textarea
                  value={selectedScene.subtitle}
                  onChange={(event) => updateScene({ subtitle: event.target.value })}
                />
              </label>
              <label>
                画面说明
                <textarea
                  value={selectedScene.visualDescription}
                  onChange={(event) => updateScene({ visualDescription: event.target.value })}
                />
              </label>
              <label>
                素材搜索词
                <input
                  value={selectedScene.searchTerms.join('，')}
                  onChange={(event) =>
                    updateScene({
                      searchTerms: event.target.value
                        .split(/[，,]/)
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label>
                AI 生成提示词
                <textarea
                  value={selectedScene.generationPrompt}
                  onChange={(event) => updateScene({ generationPrompt: event.target.value })}
                />
              </label>
              <div className="media-material-status">
                <strong>这个镜头用什么画面？</strong>
                <div className="media-source-tabs" role="group" aria-label="素材来源">
                  {(
                    [
                      { id: 'local', label: '录屏 / 本地' },
                      { id: 'search', label: '搜索素材' },
                      { id: 'generate', label: 'AI 生成' },
                    ] as const
                  ).map((source) => (
                    <button
                      key={source.id}
                      type="button"
                      aria-pressed={materialSource === source.id}
                      onClick={() => setMaterialSource(source.id)}
                    >
                      {source.label}
                    </button>
                  ))}
                </div>
                {materialSource === 'local' && (
                  <>
                    <select
                      aria-label="已导入素材"
                      value={selectedScene.assetId ?? ''}
                      onChange={(event) =>
                        updateScene({
                          assetId: event.target.value || null,
                          materialKind: event.target.value ? 'workspace' : 'unassigned',
                        })
                      }
                    >
                      <option value="">尚未选择</option>
                      {(draft.assets ?? [])
                        .filter((asset) => asset.kind !== 'audio')
                        .map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.fileName}
                          </option>
                        ))}
                    </select>
                    <button type="button" onClick={() => void importAsset()}>
                      导入本地图片或视频
                    </button>
                    <small>可导入产品录屏、实拍视频或截图；仅替换当前镜头。</small>
                  </>
                )}
                {materialSource === 'generate' && (
                  <>
                    <p>
                      {videoProvider?.configured
                        ? '即梦视频已配置 · 文生视频'
                        : videoProvider?.reason || '即梦视频尚未配置，请在设置中配置凭证'}
                    </p>
                    <p>当前支持图片生成与文生视频。参考图生视频尚未接入。</p>
                    <div className="media-generate-row">
                      <select
                        aria-label="图片生成 Provider"
                        value={imageProviderId}
                        onChange={(event) =>
                          setImageProviderId(event.target.value as 'meshy' | 'jimeng')
                        }
                      >
                        {imageProviders.map((provider) => (
                          <option
                            key={provider.id}
                            value={provider.id}
                            disabled={!provider.configured}
                          >
                            {provider.id === 'jimeng' ? '即梦' : 'Meshy'}
                            {provider.configured ? '' : '（未配置）'}
                          </option>
                        ))}
                        {imageProviders.length === 0 && (
                          <option value="jimeng">未配置图片 Provider</option>
                        )}
                      </select>
                      <button
                        type="button"
                        disabled={generatingImage || !selectedScene.generationPrompt.trim()}
                        onClick={() => void generateSceneImage()}
                      >
                        {generatingImage ? '生成中…' : '生成图片'}
                      </button>
                    </div>
                  </>
                )}
                {materialSource === 'search' && (
                  <>
                    <div className="media-search-row">
                      <input
                        aria-label="搜索素材关键词"
                        value={assetSearchQuery}
                        onChange={(event) => setAssetSearchQuery(event.target.value)}
                      />
                      <select
                        aria-label="搜索素材类型"
                        value={assetSearchKind}
                        onChange={(event) =>
                          setAssetSearchKind(event.target.value as 'image' | 'video')
                        }
                      >
                        <option value="image">图片</option>
                        <option value="video">视频</option>
                      </select>
                      <button
                        type="button"
                        disabled={searchingAssets}
                        onClick={() => void searchAssets()}
                      >
                        {searchingAssets ? '搜索中…' : '搜索素材'}
                      </button>
                    </div>
                    {assetSearchResults.length > 0 && (
                      <div className="media-search-results" aria-label="Pexels 搜索结果">
                        {assetSearchResults.map((candidate) => (
                          <div key={candidate.id} className="media-search-candidate">
                            <img src={candidate.thumbnailUrl} alt={`由 ${candidate.author} 提供`} />
                            <span>
                              <a href={candidate.sourceUrl} target="_blank" rel="noreferrer">
                                {candidate.author} · Pexels
                              </a>
                              <button
                                type="button"
                                disabled={addingCandidateId !== null}
                                onClick={() => void addSearchCandidate(candidate)}
                              >
                                {addingCandidateId === candidate.id ? '添加中…' : '添加'}
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {materialSource === 'generate' && (
                  <div className="media-generate-row">
                    <select
                      aria-label="视频生成时长"
                      value={videoDuration}
                      onChange={(event) => setVideoDuration(Number(event.target.value) as 5 | 10)}
                    >
                      <option value={5}>5 秒</option>
                      <option value={10}>10 秒</option>
                    </select>
                    <button
                      type="button"
                      disabled={submittingVideo || !selectedScene.generationPrompt.trim()}
                      onClick={() => void createVideoTask()}
                    >
                      {submittingVideo ? '提交中…' : '生成视频'}
                    </button>
                  </div>
                )}
                <span>
                  {selectedAsset
                    ? `${selectedAsset.kind === 'image' ? '图片' : '视频'} · ${(
                        selectedAsset.sizeBytes /
                        1024 /
                        1024
                      ).toFixed(1)} MB · 已复制到工程`
                    : '当前场景仍有素材缺口'}
                </span>
              </div>
            </aside>
          )}
        </div>
      )}
      <footer className="media-workflow-footer">
        <button
          type="button"
          disabled={activeStageIndex === 0}
          onClick={() => setStage(MEDIA_WORKFLOW_STAGES[activeStageIndex - 1].id)}
        >
          ← 上一步
        </button>
        <span>
          {draft.scenes.length} 个镜头 · {totalDuration.toFixed(1)} 秒 ·{' '}
          {missingMaterialCount ? `${missingMaterialCount} 个素材缺口` : '素材已齐'}
        </span>
        {activeStageIndex < MEDIA_WORKFLOW_STAGES.length - 1 ? (
          <button
            type="button"
            onClick={() => setStage(MEDIA_WORKFLOW_STAGES[activeStageIndex + 1].id)}
          >
            下一步：{MEDIA_WORKFLOW_STAGES[activeStageIndex + 1].label} →
          </button>
        ) : (
          <span>导出后可在下方任务中播放整片</span>
        )}
      </footer>
      {videoTasks.length > 0 && (
        <section className="media-task-drawer" aria-label="视频生成任务">
          <strong>视频任务</strong>
          {videoTasks.slice(0, 5).map((task) => (
            <div key={task.id}>
              <span>
                场景 {draft.scenes.findIndex((scene) => scene.id === task.sceneId) + 1} · 即梦 3.0
                Pro · {task.durationSeconds}s
              </span>
              <span>{videoTaskStatusLabel(task)}</span>
              {task.outputAsset && (
                <button type="button" onClick={() => adoptVideoTask(task)}>
                  采用结果
                </button>
              )}
              {(task.status === 'failed' || task.status === 'unknown') && (
                <button type="button" onClick={() => void retryVideoTask(task)}>
                  付费重试
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {renderTasks.length > 0 && (
        <section className="media-task-drawer" aria-label="成片导出任务">
          <strong>成片导出</strong>
          {renderTasks.slice(0, 5).map((task) => (
            <div key={task.id}>
              <span>{task.outputPath}</span>
              <span>{renderTaskStatusLabel(task)}</span>
              {task.status === 'succeeded' && (
                <span className="media-task-actions">
                  <button type="button" onClick={() => void previewRenderTask(task)}>
                    预览
                  </button>
                  <button
                    type="button"
                    onClick={() => void window.cclinkStudio.fs.openPath(task.outputPath)}
                  >
                    打开成片
                  </button>
                </span>
              )}
              {task.status === 'failed' && (
                <button type="button" onClick={() => void retryRenderTask(task)}>
                  重试导出
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function videoTaskStatusLabel(task: MediaVideoTask): string {
  if (task.status === 'queued') return '排队中'
  if (task.status === 'running') return '生成中'
  if (task.status === 'succeeded') return task.outputAsset ? '已下载' : '下载中'
  if (task.status === 'failed') return `失败：${task.errorMessage ?? '未知错误'}`
  if (task.status === 'unknown') return `状态未知：${task.errorMessage ?? '可稍后刷新'}`
  return '已取消'
}

function renderTaskStatusLabel(task: MediaRenderTask): string {
  if (task.status === 'succeeded') return '已导出 MP4、SRT 与来源清单'
  if (task.status === 'failed') return `失败（${task.step}）：${task.errorMessage ?? '未知错误'}`
  return `${task.step} · ${task.progress}%`
}

function defaultRenderSettings(project: MediaProject): NonNullable<MediaProject['renderSettings']> {
  return (
    project.renderSettings ?? {
      logoAssetId: null,
      musicAssetId: null,
      musicVolume: 0.18,
      transition: 'cut',
    }
  )
}

function appendAsset(assets: MediaProjectAsset[], asset: MediaProjectAsset): MediaProjectAsset[] {
  return assets.some((candidate) => candidate.id === asset.id) ? assets : [...assets, asset]
}

function missingVisualAssets(project: MediaProject): MediaProjectScene[] {
  const assets = new Map((project.assets ?? []).map((asset) => [asset.id, asset]))
  return project.scenes.filter((scene) => {
    const asset = assets.get(scene.assetId ?? '')
    return !asset || (asset.kind !== 'image' && asset.kind !== 'video')
  })
}

function safeFileName(value: string): string {
  return (
    value
      .replace(/[\\/:*?"<>|]/g, '-')
      .trim()
      .slice(0, 100) || '宣发视频'
  )
}
