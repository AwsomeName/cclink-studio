import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { useTabStore } from '../../stores/tab-store'

interface ModelViewerProps {
  filePath: string
}

interface ModelInfo {
  vertices: number
  triangles: number
  objects: number
  animations: number
  size?: {
    x: number
    y: number
    z: number
  }
}

type STLGeometryWithColor = THREE.BufferGeometry & {
  hasColors?: boolean
  alpha?: number
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function getExtension(filePath: string): string {
  const fileName = filePath.split('/').pop() ?? ''
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath
}

function isStepExtension(extension: string): boolean {
  return extension === '.step' || extension === '.stp'
}

function createSTLModel(arrayBuffer: ArrayBuffer, fileName: string): THREE.Mesh {
  const geometry = new STLLoader().parse(arrayBuffer) as STLGeometryWithColor
  if (!geometry.getAttribute('normal')) {
    geometry.computeVertexNormals()
  }

  const alpha = geometry.alpha ?? 1
  const material = new THREE.MeshStandardMaterial({
    color: geometry.hasColors ? 0xffffff : 0x8dd5ff,
    vertexColors: geometry.hasColors === true,
    side: THREE.DoubleSide,
    roughness: 0.58,
    metalness: 0.08,
    transparent: alpha < 1,
    opacity: alpha,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = fileName
  return mesh
}

function walkObjects(root: THREE.Object3D, visitor: (object: THREE.Object3D) => void): void {
  const stack = [root]
  while (stack.length > 0) {
    const object = stack.pop()!
    visitor(object)
    for (let index = object.children.length - 1; index >= 0; index -= 1) {
      stack.push(object.children[index])
    }
  }
}

function updateWorldMatrices(root: THREE.Object3D): void {
  root.updateMatrix()
  root.matrixWorld.copy(root.matrix)

  const stack = [...root.children.map((child) => ({ object: child, parent: root }))]
  while (stack.length > 0) {
    const { object, parent } = stack.pop()!
    object.updateMatrix()
    object.matrixWorld.multiplyMatrices(parent.matrixWorld, object.matrix)
    for (let index = object.children.length - 1; index >= 0; index -= 1) {
      stack.push({ object: object.children[index], parent: object })
    }
  }
}

function computeModelBox(root: THREE.Object3D): THREE.Box3 {
  updateWorldMatrices(root)

  const box = new THREE.Box3()
  const meshBox = new THREE.Box3()
  let hasGeometry = false

  walkObjects(root, (object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return

    const geometry = mesh.geometry
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox()
    }
    if (!geometry.boundingBox) return

    meshBox.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld)
    box.union(meshBox)
    hasGeometry = true
  })

  if (!hasGeometry) {
    box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1))
  }

  return box
}

function calculateModelInfo(
  root: THREE.Object3D,
  animations: THREE.AnimationClip[],
  size?: THREE.Vector3,
): ModelInfo {
  let vertices = 0
  let triangles = 0
  let objects = 0

  walkObjects(root, (object) => {
    objects += 1
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return

    const geometry = mesh.geometry
    const position = geometry.getAttribute('position')
    vertices += position?.count ?? 0

    if (geometry.index) {
      triangles += geometry.index.count / 3
    } else if (position) {
      triangles += position.count / 3
    }
  })

  return {
    vertices: Math.round(vertices),
    triangles: Math.round(triangles),
    objects,
    animations: animations.length,
    size: size
      ? {
          x: size.x,
          y: size.y,
          z: size.z,
        }
      : undefined,
  }
}

function normalizeModel(root: THREE.Object3D): void {
  const box = computeModelBox(root)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxAxis = Math.max(size.x, size.y, size.z)

  if (maxAxis > 0) {
    const scale = 3 / maxAxis
    root.scale.multiplyScalar(scale)
    root.position.sub(center.multiplyScalar(scale))
  } else {
    root.position.sub(center)
  }
}

export function ModelViewer({ filePath }: ModelViewerProps): React.ReactElement {
  const openTab = useTabStore((state) => state.openTab)
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const modelRef = useRef<THREE.Object3D | null>(null)
  const initialCameraRef = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const showGridRef = useRef(true)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [conversionNotice, setConversionNotice] = useState('')
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null)
  const [wireframe, setWireframe] = useState(false)
  const [showGrid, setShowGrid] = useState(true)

  useEffect(() => {
    showGridRef.current = showGrid
  }, [showGrid])

  const openCadSettings = useCallback(() => {
    openTab({ type: 'settings', title: '硬件与 CAD', icon: '⚙️', settingsSection: 'cad' })
  }, [openTab])

  const resetCamera = useCallback(() => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    const initial = initialCameraRef.current
    if (!camera || !controls || !initial) return

    camera.position.copy(initial.position)
    controls.target.copy(initial.target)
    controls.update()
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1e1e1e)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
    camera.position.set(4, 3, 6)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    rendererRef.current = renderer
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controlsRef.current = controls

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.8)
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
    keyLight.position.set(4, 6, 5)
    const fillLight = new THREE.DirectionalLight(0x9cc7ff, 1.1)
    fillLight.position.set(-5, 3, -4)
    const grid = new THREE.GridHelper(8, 16, 0x3c3c3c, 0x2b2b2b)
    grid.name = 'model-viewer-grid'

    scene.add(ambientLight, keyLight, fillLight, grid)

    let animationId = 0
    let mixer: THREE.AnimationMixer | null = null
    const clock = new THREE.Clock()

    const resize = (): void => {
      const width = container.clientWidth
      const height = container.clientHeight
      if (width <= 0 || height <= 0) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    const setModelWireframe = (root: THREE.Object3D, enabled: boolean): void => {
      walkObjects(root, (object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh) return
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const material of materials) {
          if ('wireframe' in material) {
            ;(material as THREE.MeshStandardMaterial).wireframe = enabled
            material.needsUpdate = true
          }
        }
      })
    }

    const loadModel = async (): Promise<void> => {
      try {
        setLoading(true)
        setError('')
        setConversionNotice('')
        setModelInfo(null)

        let sourceFilePath = filePath
        let extension = getExtension(filePath)
        if (isStepExtension(extension)) {
          const cadApi = window.cclinkStudio.cad
          if (!cadApi?.convertModel || !cadApi.getModelSupport) {
            throw new Error(
              'CAD 转换能力尚未加载。请重启 CCLink Studio 让主进程和 preload 生效，然后在设置中启用本机 FreeCAD。',
            )
          }

          const support = await cadApi.getModelSupport(filePath)
          if (!support.canPreview) {
            const detail = support.backend?.error?.detail ? `\n${support.backend.error.detail}` : ''
            throw new Error(
              `${support.message}\n请在设置 > 硬件与 CAD 选择“本机 FreeCAD”并完成检测。${detail}`,
            )
          }

          setConversionNotice('正在用 CAD 转换后端生成 STEP 预览...')
          const converted = await cadApi.convertModel({
            inputPath: filePath,
            targetFormat: 'stl',
          })
          if (!converted.success || !converted.previewPath || !converted.format) {
            const detail = converted.error?.detail ? `\n${converted.error.detail}` : ''
            throw new Error(`${converted.error?.message ?? 'STEP/STP 转换失败。'}${detail}`)
          }
          sourceFilePath = converted.previewPath
          extension = `.${converted.format}`
          setConversionNotice(converted.cached ? '已使用缓存的 STEP 预览。' : 'STEP 预览转换完成。')
        }

        const result = await window.cclinkStudio.fs.readFile(sourceFilePath)
        const content = typeof result === 'string' ? result : result.content
        const arrayBuffer = base64ToArrayBuffer(content)

        let model: THREE.Object3D
        let animations: THREE.AnimationClip[] = []

        if (extension === '.fbx') {
          model = new FBXLoader().parse(arrayBuffer, '')
          animations = model.animations
        } else if (extension === '.glb' || extension === '.gltf') {
          const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(
            (resolve, reject) => {
              new GLTFLoader().parse(arrayBuffer, '', resolve, reject)
            },
          )
          model = gltf.scene
          animations = gltf.animations
        } else if (extension === '.stl') {
          model = createSTLModel(arrayBuffer, getFileName(filePath))
        } else if (extension === '.3mf') {
          model = new ThreeMFLoader().parse(arrayBuffer)
        } else {
          throw new Error(`暂不支持的 3D 模型格式: ${extension || 'unknown'}`)
        }

        const originalSize = computeModelBox(model).getSize(new THREE.Vector3())
        normalizeModel(model)
        modelRef.current = model
        scene.add(model)
        setModelWireframe(model, wireframe)

        if (animations.length > 0) {
          mixer = new THREE.AnimationMixer(model)
          mixer.clipAction(animations[0]).play()
        }

        setModelInfo(calculateModelInfo(model, animations, originalSize))
        initialCameraRef.current = {
          position: new THREE.Vector3(4, 3, 6),
          target: new THREE.Vector3(0, 0, 0),
        }
        resetCamera()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }

    const animate = (): void => {
      animationId = requestAnimationFrame(animate)
      const delta = clock.getDelta()
      mixer?.update(delta)
      controls.update()
      grid.visible = showGridRef.current
      renderer.render(scene, camera)
    }

    void loadModel()
    animate()

    return () => {
      cancelAnimationFrame(animationId)
      observer.disconnect()
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      walkObjects(scene, (object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry?.dispose()
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const material of materials) {
          material.dispose()
        }
      })
      rendererRef.current = null
      cameraRef.current = null
      controlsRef.current = null
      modelRef.current = null
    }
  }, [filePath])

  useEffect(() => {
    if (!modelRef.current) return
    walkObjects(modelRef.current, (object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        if ('wireframe' in material) {
          ;(material as THREE.MeshStandardMaterial).wireframe = wireframe
          material.needsUpdate = true
        }
      }
    })
  }, [wireframe])

  return (
    <div className="model-viewer">
      <div className="model-viewer-toolbar">
        <div className="model-viewer-title">
          <span className="model-viewer-file">{getFileName(filePath)}</span>
          {modelInfo && (
            <span className="model-viewer-meta">
              {modelInfo.objects} objects · {modelInfo.vertices.toLocaleString()} vertices ·{' '}
              {modelInfo.triangles.toLocaleString()} tris
              {modelInfo.animations > 0 ? ` · ${modelInfo.animations} animations` : ''}
              {modelInfo.size
                ? ` · ${modelInfo.size.x.toFixed(2)} × ${modelInfo.size.y.toFixed(2)} × ${modelInfo.size.z.toFixed(2)} mm`
                : ''}
            </span>
          )}
          {conversionNotice && <span className="model-viewer-meta">{conversionNotice}</span>}
        </div>
        <div className="model-viewer-actions">
          <button onClick={resetCamera} title="重置视角">
            重置视角
          </button>
          <button
            className={showGrid ? 'active' : ''}
            onClick={() => setShowGrid((value) => !value)}
            title="显示或隐藏网格"
          >
            网格
          </button>
          <button
            className={wireframe ? 'active' : ''}
            onClick={() => setWireframe((value) => !value)}
            title="切换线框模式"
          >
            线框
          </button>
        </div>
      </div>
      <div className="model-viewer-canvas" ref={containerRef}>
        {loading && (
          <div className="model-viewer-overlay">
            <div className="wechat-preview-spinner" />
            <span>{conversionNotice || '正在加载 3D 模型...'}</span>
          </div>
        )}
        {error && (
          <div className="model-viewer-overlay model-viewer-error">
            <span className="model-viewer-error-icon">⚠️</span>
            <span>模型加载失败</span>
            <span className="model-viewer-error-msg">{error}</span>
            {isStepExtension(getExtension(filePath)) && (
              <button className="model-viewer-error-action" onClick={openCadSettings}>
                打开 CAD 设置
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
