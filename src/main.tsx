import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/inter'
import App from './App'
import './design-system/tokens.css'
import './design-system/components.css'
import './styles/tokens.css'
import './styles/global.css'
import './styles/shell.css'
import './styles/premium-refinement.css'
import './styles/vdp-final-refinement.css'
import './styles/typography-hardening.css'
import './styles/app-system-polish.css'
import './styles/inventory-experience-final.css'
import './styles/readability-final.css'
import './styles/inventory-production-v10.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
