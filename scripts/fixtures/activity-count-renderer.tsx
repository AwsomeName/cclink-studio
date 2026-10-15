import React from 'react'
import { createRoot } from 'react-dom/client'
import { ActivityBar } from '../../src/renderer/src/components/activity-bar/ActivityBar'
import '../../src/renderer/src/assets/main.css'

createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'flex', height: '100vh' }}>
    <ActivityBar />
  </div>,
)
