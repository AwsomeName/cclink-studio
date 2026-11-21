import { createPortal } from 'react-dom'
import { useFixedSpacesStore } from './fixed-spaces-store'
import { DiarySetupWizard } from './DiarySetupWizard'
import { useFloatingSurfaceRegistration } from '../../components/common/floating-surface-registry'
import { useEscapeDismiss } from '../../components/common/dismissable-layer'
import './fixed-spaces.css'

/** First use before any folder exists: shown over the workbench until the user confirms. */
export function PersonalFirstUseOverlay(): React.ReactElement | null {
  const open = useFixedSpacesStore((state) => state.firstUse)
  const close = (): void => useFixedSpacesStore.setState({ firstUse: false })
  useFloatingSurfaceRegistration(open)
  useEscapeDismiss(open, close)
  if (!open) return null
  return createPortal(
    <div className="fixed-space-overlay">
      <div
        className="fixed-space-dialog diary-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="设置我的空间"
      >
        <header>
          <span>我的空间 / 首次使用</span>
          <button onClick={close} aria-label="关闭首次使用">
            ×
          </button>
        </header>
        <DiarySetupWizard owner={null} onDone={close} />
      </div>
    </div>,
    document.body,
  )
}
