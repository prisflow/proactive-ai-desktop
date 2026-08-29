import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n'
import './styles/theme.css'
import './styles/typography.css'
import './styles/scrollbar.css'
import './index.css'
import './styles/markdown.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
