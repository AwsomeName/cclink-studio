import { describe, expect, it, vi } from 'vitest'
import { CadToolModule } from './index'

const localContext = {
  trustedWorkspace: {
    kind: 'local' as const,
    rootPath: '/project',
    workspaceKey: '/project',
  },
}

function createModule(
  overrides: {
    conversion?: Record<string, unknown>
    modification?: Record<string, unknown>
    file?: Record<string, unknown>
  } = {},
) {
  const file = {
    withAccess: vi.fn((_context, operation: () => unknown) => operation()),
    assertReadableFile: vi.fn(async (path: string) => path),
    assertNewWritableTarget: vi.fn(async (path: string) => path),
    ...overrides.file,
  }
  return {
    module: new CadToolModule(
      (overrides.conversion ?? {}) as any,
      (overrides.modification ?? {}) as any,
      file as any,
    ),
    file,
  }
}

const planParams = {
  inputPath: '/project/model.step',
  outputPath: '/project/model-longer.step',
  operation: 'section-insert',
  axis: 'x',
  direction: 'positive',
  distanceMm: 3,
  splitPlane: 3.75,
  fixedSide: 'min',
}

describe('CadToolModule', () => {
  it('exposes the existing diagnostics and only two editing tools', () => {
    const { module } = createModule()

    expect(module.tools.map((tool) => tool.name)).toEqual([
      'cad_get_backend_status',
      'cad_get_model_support',
      'cad_inspect_model',
      'cad_convert_model',
      'cad_get_cache_status',
      'cad_clear_cache',
      'cad_plan_modification',
      'cad_modify_step',
    ])
  })

  it('requires a trusted local workspace for every path operation', async () => {
    const { module } = createModule()

    await expect(
      module.execute('cad_get_model_support', { inputPath: '/project/model.step' }),
    ).rejects.toThrow('LOCAL_WORKSPACE_REQUIRED')
  })

  it('authorizes the source path before model inspection', async () => {
    const inspectModel = vi.fn().mockResolvedValue({ cacheHit: true })
    const { module, file } = createModule({ conversion: { inspectModel } })

    await expect(
      module.execute('cad_inspect_model', { inputPath: '/project/model.step' }, localContext),
    ).resolves.toEqual({ cacheHit: true })
    expect(file.withAccess).toHaveBeenCalledWith(
      { trustedWorkspace: localContext.trustedWorkspace },
      expect.any(Function),
    )
    expect(file.assertReadableFile).toHaveBeenCalledWith('/project/model.step')
    expect(inspectModel).toHaveBeenCalledWith('/project/model.step')
  })

  it('delegates supported preview conversion after path authorization', async () => {
    const convertModel = vi.fn().mockResolvedValue({ success: true })
    const { module } = createModule({ conversion: { convertModel } })

    await expect(
      module.execute(
        'cad_convert_model',
        { inputPath: '/project/model.step', targetFormat: 'stl' },
        localContext,
      ),
    ).resolves.toEqual({ success: true })
    expect(convertModel).toHaveBeenCalledWith({
      inputPath: '/project/model.step',
      targetFormat: 'stl',
      force: false,
    })
  })

  it('authorizes both paths and returns the modification plan', async () => {
    const plan = vi.fn().mockResolvedValue({ kind: 'cad-modification-plan' })
    const { module, file } = createModule({ modification: { plan } })

    await expect(
      module.execute('cad_plan_modification', planParams, localContext),
    ).resolves.toEqual({ kind: 'cad-modification-plan' })
    expect(file.assertReadableFile).toHaveBeenCalledWith(planParams.inputPath)
    expect(file.assertNewWritableTarget).toHaveBeenCalledWith(planParams.outputPath)
    expect(plan).toHaveBeenCalledWith(planParams, { signal: undefined })
  })

  it('passes the Agent run abort signal to FreeCAD planning', async () => {
    const plan = vi.fn().mockResolvedValue({ kind: 'cad-modification-plan' })
    const { module } = createModule({ modification: { plan } })
    const controller = new AbortController()

    await module.execute('cad_plan_modification', planParams, {
      ...localContext,
      abortSignal: controller.signal,
    })

    expect(plan).toHaveBeenCalledWith(planParams, { signal: controller.signal })
  })

  it('always requires one confirmation for cad_modify_step and disallows allow-always', () => {
    const { module } = createModule()

    expect(module.getExecutionPolicy('cad_modify_step')).toEqual({
      requireConfirmation: true,
      riskLevel: 'write',
      allowAlways: false,
      reason: '将按下列已确认参数生成新的 STEP 文件；原文件不会被覆盖。',
    })
  })

  it('refuses modification without the current confirmation grant', async () => {
    const { module } = createModule()

    await expect(
      module.execute(
        'cad_modify_step',
        {
          ...planParams,
          sourceHash: 'a'.repeat(64),
          expectedSizeX: 151,
          expectedSizeY: 42,
          expectedSizeZ: 50,
        },
        localContext,
      ),
    ).rejects.toThrow('CONFIRMATION_REQUIRED')
  })

  it('passes the exact confirmed snapshot and abort signal to the modification service', async () => {
    const modify = vi.fn().mockResolvedValue({ kind: 'cad-modification-result', success: true })
    const { module } = createModule({ modification: { modify } })
    const abortController = new AbortController()
    const snapshot = {
      ...planParams,
      sourceHash: 'a'.repeat(64),
      expectedSizeX: 151,
      expectedSizeY: 42,
      expectedSizeZ: 50,
    }

    await module.execute('cad_modify_step', snapshot, {
      ...localContext,
      confirmationGranted: true,
      abortSignal: abortController.signal,
    })

    expect(modify).toHaveBeenCalledWith(snapshot, { signal: abortController.signal })
  })
})
