import { useState, useRef, useEffect } from 'react'
import type { ChatAreaHandle } from './components/ChatArea'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import InputArea from './components/InputArea'
import Settings from './components/Settings'
import LogViewer from './components/LogViewer'
import WindowChrome from './components/WindowChrome'
import { ToastContainer } from './components/ui/toast'
import { useConversationStore } from './stores/conversationStore'
import { useChatStore } from './stores/chatStore'
import { useConfigStore } from './stores/configStore'
import { useSyncDocumentTheme } from './hooks/useSyncDocumentTheme'

export default function App() {
  const [showSettings, setShowSettings] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [chatAtBottom, setChatAtBottom] = useState(true)
  const chatRef = useRef<ChatAreaHandle>(null)
  const loadConversations = useConversationStore((s) => s.loadConversations)
  const loadConfig = useConfigStore((s) => s.loadConfig)

  useSyncDocumentTheme()

  useEffect(() => {
    loadConfig()
    loadConversations()
  }, [loadConfig, loadConversations])

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[var(--app-bg)] font-sans text-[var(--app-fg)]">
      <WindowChrome />
      <div className="flex min-h-0 flex-1">
        <Sidebar onOpenSettings={() => setShowSettings(true)} onOpenLogs={() => setShowLogs(true)} />
        <main className="flex min-h-0 min-w-0 flex-1">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <ChatArea ref={chatRef} onScrollChange={setChatAtBottom} />
            <InputArea chatAtBottom={chatAtBottom} onScrollToBottom={() => {
              const convId = useConversationStore.getState().currentConversationId
              if (!convId) return
              const msgs = useChatStore.getState().messages[convId]
              if (!msgs) return
              chatRef.current?.scrollToLastUserMessage(msgs, 'smooth')
            }} />
          </div>
        </main>
      </div>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showLogs && <LogViewer onClose={() => setShowLogs(false)} />}
      <ToastContainer />
    </div>
  )
}
