export interface WindowApiContract {
  toggleFullscreen: () => Promise<{ success: boolean; fullscreen?: boolean }>
  toggleDevtools: () => Promise<{ success: boolean }>
  reload: () => Promise<{ success: boolean }>
  focusRenderer: () => Promise<{ success: boolean }>
}
