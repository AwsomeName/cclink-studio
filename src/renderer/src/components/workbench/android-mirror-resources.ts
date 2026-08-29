interface MutableResourceRef<T> {
  current: T
}

export interface AndroidMirrorResourceRefs {
  videoFrameUnsubscribeRef: MutableResourceRef<(() => void) | null>
  mirrorErrorUnsubscribeRef: MutableResourceRef<(() => void) | null>
  streamControllerRef: MutableResourceRef<{ close(): void } | null>
  decoderRef: MutableResourceRef<{ dispose(): void } | null>
}

/** 幂等释放 renderer 自己拥有的投屏资源，不触发 main 侧 disconnect。 */
export function cleanupAndroidMirrorResources(resources: AndroidMirrorResourceRefs): void {
  resources.videoFrameUnsubscribeRef.current?.()
  resources.videoFrameUnsubscribeRef.current = null
  resources.mirrorErrorUnsubscribeRef.current?.()
  resources.mirrorErrorUnsubscribeRef.current = null

  try {
    resources.streamControllerRef.current?.close()
  } catch {
    /* ignore */
  }
  resources.streamControllerRef.current = null

  try {
    resources.decoderRef.current?.dispose()
  } catch {
    /* ignore */
  }
  resources.decoderRef.current = null
}
