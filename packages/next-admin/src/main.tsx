import { ApolloProvider } from '@apollo/client/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { client } from './apollo'
import App from './App.tsx'
import { ThemeProvider } from './theme/ThemeProvider'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('管理后台挂载节点不存在')

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <ApolloProvider client={client}>
        <App />
      </ApolloProvider>
    </ThemeProvider>
  </StrictMode>,
)
