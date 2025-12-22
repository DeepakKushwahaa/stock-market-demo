import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@eleung/react-grid-layout/css/styles.css'
import './assets/styles/tailwind.css'
import './assets/styles/global.scss'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
