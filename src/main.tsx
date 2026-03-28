import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

// Auto-update Service Worker
registerSW({
  onNeedRefresh() {
    // Could show a toast: "New version available, click to update"
    console.log('[SW] New content available, will auto-update.')
  },
  onOfflineReady() {
    console.log('[SW] App ready to work offline.')
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
