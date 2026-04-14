import { Menu, Plus, MessageSquare, Settings, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSidebar } from '@/hooks/useSidebar'
import { useConversationStore } from '@/stores/conversationStore'
import { useChatStore } from '@/stores/chatStore'
import type { ChatMessage, Conversation } from '@shared'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

interface SidebarProps {
  onOpenSettings: () => void
}

/** 菜单左缘与 ⋮ 按钮左缘对齐：bottom + align start */
function ConversationMoreMenu({
  open,
  onOpenChange,
  onRename,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRename: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <div
        className={cn(
          'shrink-0 pr-1 transition-opacity',
          open
            ? 'opacity-100'
            : 'opacity-0 pointer-events-none group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100'
        )}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="cursor-pointer rounded-full p-2 text-[var(--app-muted)] outline-none transition-colors hover:bg-[var(--app-hover-strong)] hover:text-[var(--app-fg)] focus-visible:ring-2 focus-visible:ring-[color:var(--app-focus-ring)] focus-visible:ring-offset-0"
            aria-label={t('sidebar.convActions')}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical size={16} strokeWidth={2} />
          </button>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent side="bottom" align="start" sideOffset={6} className="min-w-[10.5rem] p-1">
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            onOpenChange(false)
            onRename()
          }}
        >
          <Pencil size={16} className="shrink-0 text-[var(--app-muted)]" aria-hidden />
          <span className="text-[var(--app-fg)]">{t('sidebar.rename')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            onOpenChange(false)
            onDelete()
          }}
        >
          <Trash2 size={16} className="shrink-0 text-[var(--app-muted)]" aria-hidden />
          <span className="text-[var(--app-fg)]">{t('sidebar.delete')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default function Sidebar({ onOpenSettings }: SidebarProps) {
  const { t } = useTranslation()
  const { isOpen, toggle } = useSidebar()
  const {
    conversations,
    currentConversationId,
    createConversation,
    setCurrentConversation,
    deleteConversation,
    updateConversation,
  } = useConversationStore()
  const { messages, clearConversation } = useChatStore()

  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null)
  const [renameConvId, setRenameConvId] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState('')

  const handleNewConversation = async () => {
    await createConversation()
  }

  const handleSelectConversation = (id: string) => {
    setCurrentConversation(id)
  }

  const handleDeleteConversation = async (id: string) => {
    await deleteConversation(id)
    clearConversation(id)
  }

  const openRename = (conv: Conversation) => {
    setRenameConvId(conv.id)
    setRenameTitle(conv.title)
  }

  const handleRenameSave = async () => {
    if (!renameConvId) return
    const title = renameTitle.trim() || t('conversation.defaultTitle')
    await updateConversation(renameConvId, { title })
    setRenameConvId(null)
  }

  const getConversationTitle = (id: string) => {
    const convMessages = messages[id]
    if (convMessages && convMessages.length > 0) {
      const firstUserMessage = convMessages.find((m: ChatMessage) => m.role === 'user')
      if (firstUserMessage) {
        return firstUserMessage.content.slice(0, 20) + (firstUserMessage.content.length > 20 ? '...' : '')
      }
    }
    const conv = conversations.find((c: Conversation) => c.id === id)
    return conv?.title || t('conversation.defaultTitle')
  }

  return (
    <>
      <aside
        className={`${
          isOpen ? 'w-72' : 'w-16'
        } flex flex-col border-r border-[color:var(--app-border)] bg-[var(--app-surface)] transition-[width] duration-300 ease-in-out`}
      >
        <div className="sticky top-0 z-10 h-28 bg-[var(--app-surface-muted)] backdrop-blur-md">
          <div className="flex h-full flex-col justify-between px-3 py-3">
            <button
              onClick={toggle}
              className="cursor-pointer self-start rounded-full p-2 transition-colors hover:bg-[var(--app-hover-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-focus-ring)] focus-visible:ring-offset-0"
              aria-label={t('sidebar.toggle')}
              title={t('sidebar.toggle')}
            >
              <Menu size={24} />
            </button>

            <button
              onClick={handleNewConversation}
              className="relative flex w-full cursor-pointer items-center gap-3 rounded-full px-3 py-2.5 text-left hover:bg-[var(--app-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-focus-ring)] focus-visible:ring-offset-0"
              aria-label={t('sidebar.newChat')}
              title={t('sidebar.newChat')}
            >
              <Plus size={18} className="shrink-0 text-[var(--app-muted)]" />
              <span
                className={cn(
                  'text-sm font-medium transition-opacity duration-200 will-change-opacity absolute left-12',
                  isOpen ? 'opacity-100 delay-150' : 'opacity-0 delay-0 pointer-events-none'
                )}
              >
                {t('sidebar.newChat')}
              </span>
            </button>
          </div>
        </div>

        <div
          className={cn(
            'flex-1 px-3 py-2',
            isOpen ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden'
          )}
        >
          <div
            className={cn(
              'space-y-1 transition-[opacity,transform,max-height] duration-200 will-change-transform will-change-opacity',
              isOpen
                ? 'opacity-100 translate-x-0 max-h-[2000px] delay-150'
                : 'opacity-0 -translate-x-2 max-h-0 overflow-hidden pointer-events-none'
            )}
          >
            {conversations.length > 0 && (
              <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--app-muted)]">
                {t('sidebar.recent')}
              </p>
            )}
            {conversations.map((conv: Conversation) => (
              <div
                key={conv.id}
                className={cn(
                  'group/row flex w-full items-center gap-0 rounded-full transition-colors hover:bg-[var(--app-hover)]',
                  currentConversationId === conv.id ? 'bg-[var(--app-hover-strong)]' : ''
                )}
              >
                <button
                  type="button"
                  onClick={() => handleSelectConversation(conv.id)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2.5 text-left"
                  title={getConversationTitle(conv.id)}
                >
                  <MessageSquare size={18} className="shrink-0 text-[var(--app-muted)]" />
                  <span className="truncate text-sm">{getConversationTitle(conv.id)}</span>
                </button>

                <ConversationMoreMenu
                  open={menuOpenFor === conv.id}
                  onOpenChange={(o) => setMenuOpenFor(o ? conv.id : null)}
                  onRename={() => openRename(conv)}
                  onDelete={() => void handleDeleteConversation(conv.id)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="sticky bottom-0 z-10 flex h-16 items-center bg-[var(--app-surface-muted)] px-3 py-3 backdrop-blur-md [-webkit-app-region:no-drag]">
          <button
            onClick={onOpenSettings}
            className="relative flex w-full cursor-pointer items-center gap-3 rounded-full px-3 py-2.5 text-left hover:bg-[var(--app-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-focus-ring)] focus-visible:ring-offset-0"
            aria-label={t('sidebar.settings')}
            title={t('sidebar.settings')}
          >
            <Settings size={18} className="shrink-0 text-[var(--app-muted)]" />
            <span
              className={cn(
                'text-sm font-medium transition-opacity duration-200 will-change-opacity absolute left-12',
                isOpen ? 'opacity-100 delay-150' : 'opacity-0 delay-0 pointer-events-none'
              )}
            >
              {t('sidebar.settings')}
            </span>
          </button>
        </div>
      </aside>

      <Dialog
        open={renameConvId !== null}
        onOpenChange={(open) => {
          if (!open) setRenameConvId(null)
        }}
      >
        <DialogContent className="max-w-md sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('sidebar.renameTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="rename-conv-title" className="text-[var(--app-fg)]">
                {t('sidebar.titleLabel')}
              </Label>
              <Input
                id="rename-conv-title"
                value={renameTitle}
                onChange={(e) => setRenameTitle(e.target.value)}
                placeholder={t('sidebar.titlePlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleRenameSave()
                }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRenameConvId(null)}>
                {t('sidebar.cancel')}
              </Button>
              <Button type="button" onClick={() => void handleRenameSave()}>
                {t('sidebar.save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
