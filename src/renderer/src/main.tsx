import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { RootErrorFallback } from './components/common/ErrorFallback'
import './assets/main.css'
import './components/loading/LoadingScreen.css'
import './components/workbench/markdown-editor.css'
import { installRendererDiagnosticCapture } from './features/diagnostics/renderer-diagnostic-log'

installRendererDiagnosticCapture()
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallback={RootErrorFallback}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
