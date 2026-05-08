import { useState, useEffect, useCallback } from 'react'
import { subscribeAppToast, subscribeAgentPush } from './api'
import type { AgentStreamPushV1 } from '@shared'
import { useChatStore } from './stores/chatStore'
import Sidebar from './components/Sidebar'
import ChatArea from './components/ChatArea'
import InputArea from './components/InputArea'
import Settings from './components/Settings'
import WindowChrome from './components/WindowChrome'
import PluginRightRailHost from './components/PluginRightRailHost'
import { useConfigStore } from './stores/configStore'
import { useConversationStore } from './stores/conversationStore'
import { useSyncDocumentTheme } from './hooks/useSyncDocumentTheme'
import { syncI18nFromConfig } from './i18n'

export default function App() {
  useSyncDocumentTheme()
  const { loadFromMain: loadConfig } = useConfigStore()
  const locale = useConfigStore((s) => s.config.locale)
  const { loadFromMain: loadConversations } = useConversationStore()
  const [showSettings, setShowSettings] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [toast, setToast] = useState<{
    type: 'info' | 'success' | 'warning' | 'error'
    text: string
  } | null>(null)

  const dismissToast = useCallback(() => setToast(null), [])

  useEffect(() => {
    return subscribeAgentPush((raw) => {
      const p = raw as AgentStreamPushV1
      if (!p || p.v !== 1) return
      const upsert = useChatStore.getState().upsertMessage
      const stream = useChatStore.getState().applyAgentStream
      if (p.kind === 'message') {
        upsert(p.conversationId, p.message)
      } else if (p.kind === 'stream') {
        stream(p.conversationId, p.runId, p.delta, p.done)
      } else if (p.kind === 'error' && p.conversationId) {
        upsert(p.conversationId, {
          id: `err_${Date.now()}`,
          role: 'assistant',
          content: p.message,
          createdAt: Date.now(),
        })
      }
    })
  }, [])

  useEffect(() => {
    return subscribeAppToast((payload) => {
      if (payload?.v !== 1 || typeof payload.text !== 'string') return
      setToast({ type: payload.type ?? 'info', text: payload.text })
      window.setTimeout(() => setToast(null), 4200)
    })
  }, [])

  useEffect(() => {
    const init = async () => {
      await loadConfig()
      await loadConversations()
      setIsReady(true)
    }
    init()
  }, [])

  useEffect(() => {
    syncI18nFromConfig(locale)
  }, [locale])

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[var(--app-bg)] font-sans text-[var(--app-fg)]">
      <WindowChrome />
      <div className="flex min-h-0 flex-1">
        <Sidebar onOpenSettings={() => setShowSettings(true)} />
        <main className="flex min-h-0 min-w-0 flex-1">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <ChatArea />
            <InputArea />
          </div>
          <PluginRightRailHost />
        </main>
      </div>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {toast && (
        <div
          className="pointer-events-auto fixed bottom-6 left-1/2 z-[100] max-w-md -translate-x-1/2 px-4"
          role="status"
        >
          <button
            type="button"
            onClick={dismissToast}
            className={
              toast.type === 'error'
                ? 'w-full rounded-xl border border-red-500/40 bg-red-950/90 px-4 py-3 text-left text-sm text-red-50 shadow-lg backdrop-blur-sm'
                : toast.type === 'warning'
                  ? 'w-full rounded-xl border border-amber-500/40 bg-amber-950/90 px-4 py-3 text-left text-sm text-amber-50 shadow-lg backdrop-blur-sm'
                  : toast.type === 'success'
                    ? 'w-full rounded-xl border border-emerald-500/35 bg-emerald-950/90 px-4 py-3 text-left text-sm text-emerald-50 shadow-lg backdrop-blur-sm'
                    : 'w-full rounded-xl border border-[color:var(--app-border-strong)] bg-[var(--app-surface)] px-4 py-3 text-left text-sm text-[var(--app-fg)] shadow-lg backdrop-blur-sm'
            }
          >
            {toast.text}
          </button>
        </div>
      )}
    </div>
  )
}
