import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import App from './App'
import { installWorkspaceNavigationGuard } from './lib/useUnsavedChanges'
import './design-system/tokens.css'
import './design-system/components.css'
import './styles/tokens.css'
import './styles/global.css'
import './styles/shell.css'
import './styles/premium-refinement.css'
import './styles/typography-hardening.css'
import './styles/app-system-polish.css'
import './styles/readability-final.css'
import './styles/inventory-production-v10.css'

installWorkspaceNavigationGuard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
