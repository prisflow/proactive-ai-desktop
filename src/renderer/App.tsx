import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import InputArea from './components/InputArea'
import Settings from './components/Settings'
import WindowChrome from './components/WindowChrome'
import AvatarWidget from './components/AvatarWidget'
import { useConfigStore } from './stores/configStore'
import { useConversationStore } from './stores/conversationStore'
import { useSyncDocumentTheme } from './hooks/useSyncDocumentTheme'

export default function App() {
  useSyncDocumentTheme()
  const { loadFromMain: loadConfig } = useConfigStore()
  const { loadFromMain: loadConversations } = useConversationStore()
  const [showSettings, setShowSettings] = useState(false)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const init = async () => {
      await loadConfig()
      await loadConversations()
      setIsReady(true)
    }
    init()
  }, [])

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[var(--app-bg)] font-sans text-[var(--app-fg)]">
      <WindowChrome />
      <div className="flex min-h-0 flex-1">
        <Sidebar onOpenSettings={() => setShowSettings(true)} />
        <main className="relative flex min-h-0 flex-1 flex-col">
          <ChatArea />
          <InputArea />
          <AvatarWidget />
        </main>
      </div>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  )
}
