import { Menu, Plus, MessageSquare, Settings, FileText, Ellipsis, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSidebarStore } from '@/stores/sidebarStore'
import { useConversationStore } from '@/stores/conversationStore'
import { useChatStore } from '@/stores/chatStore'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { Conversation } from '@shared'

interface SidebarProps {
  onOpenSettings: () => void
  onOpenLogs: () => void
}

/**
 * 对话行的省略号操作菜单（重命名 / 删除）。
 * 仅在行 hover 或菜单展开时可见。
 */
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
            className="cursor-pointer rounded-full p-1.5 text-[var(--app-muted)] outline-none transition-colors hover:bg-[var(--app-hover-strong)] hover:text-[var(--app-fg)] focus-visible:ring-2 focus-visible:ring-[color:var(--app-focus-ring)] focus-visible:ring-offset-0"
            aria-label={t('sidebar.convActions')}
            onClick={(e) => e.stopPropagation()}
          >
            <Ellipsis size={16} strokeWidth={2} />
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

/**
 * 左侧侧边栏。
 * - 顶部：菜单折叠按钮 + 新建对话
 * - 中间：对话列表（点击切换 / 行 hover 出省略号菜单：重命名、删除）
 * - 底部：系统日志入口 + 设置入口
 * - 支持展开/折叠（通过 sidebarStore），展开时 288px，折叠时 64px
 */
export default function Sidebar({ onOpenSettings, onOpenLogs }: SidebarProps) {
  const { t } = useTranslation()
  const { isOpen, toggle } = useSidebarStore()
  const { conversations, currentConversationId, createConversation, setCurrentConversation, deleteConversation, renameConversation } =
    useConversationStore()
  const { clearConversation } = useChatStore()

  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null)
  const [renameConvId, setRenameConvId] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState('')

  const handleNew = async () => {
    await createConversation()
  }

  const handleDelete = async (id: string) => {
    // 删除正在流式的对话时先中断，避免后台继续生成并写入已删除对话
    if (useChatStore.getState().busyConversations[id]) {
      const { chatAbort } = await import('@/api')
      await chatAbort(id)
    }
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
    await renameConversation(renameConvId, title)
    setRenameConvId(null)
  }

  return (
    <>
      <aside
        className={`${
          isOpen ? 'w-72' : 'w-16'
        } flex flex-col border-r border-[color:var(--app-border)] bg-[var(--app-surface)] transition-[width] duration-300`}
      >
        <div className="sticky top-0 z-10 h-28 bg-[var(--app-surface-muted)] backdrop-blur-md">
          <div className="flex h-full flex-col justify-between px-3 py-3">
            <button onClick={toggle} className="self-start rounded-full p-2 hover:bg-[var(--app-hover-strong)]">
              <Menu size={24} />
            </button>
            <button
              onClick={handleNew}
              className="flex w-full items-center gap-3 rounded-full px-3 py-2.5 hover:bg-[var(--app-hover)]"
            >
              <Plus size={18} className="shrink-0 text-[var(--app-muted)]" />
              <span className={cn('text-sm font-medium truncate transition-opacity duration-300', isOpen ? 'opacity-100' : 'opacity-0')}>
                {t('sidebar.newChat')}
              </span>
            </button>
          </div>
        </div>

        <div className={cn('flex-1 px-3 py-2', isOpen ? 'overflow-y-auto' : 'overflow-hidden')}>
          <div className={cn('space-y-1', isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  'group/row flex items-center rounded-full hover:bg-[var(--app-hover)]',
                  currentConversationId === conv.id ? 'bg-[var(--app-hover-strong)]' : ''
                )}
              >
                <button
                  onClick={() => setCurrentConversation(conv.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
                >
                  <MessageSquare size={18} className="shrink-0 text-[var(--app-muted)]" />
                  <span className="truncate text-sm">{conv.title}</span>
                </button>
                <ConversationMoreMenu
                  open={menuOpenFor === conv.id}
                  onOpenChange={(o) => setMenuOpenFor(o ? conv.id : null)}
                  onRename={() => openRename(conv)}
                  onDelete={() => void handleDelete(conv.id)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="sticky bottom-0 z-10 flex flex-col gap-1 bg-[var(--app-surface-muted)] px-3 py-3">
          <button
            onClick={onOpenLogs}
            className="flex w-full items-center gap-3 rounded-full px-3 py-2.5 hover:bg-[var(--app-hover)]"
          >
            <FileText size={18} className="shrink-0 text-[var(--app-muted)]" />
            <span className={cn('text-sm font-medium truncate transition-opacity duration-300', isOpen ? 'opacity-100' : 'opacity-0')}>{t('sidebar.systemLogs')}</span>
          </button>
          <button
            onClick={onOpenSettings}
            className="flex w-full items-center gap-3 rounded-full px-3 py-2.5 hover:bg-[var(--app-hover)]"
          >
            <Settings size={18} className="shrink-0 text-[var(--app-muted)]" />
            <span className={cn('text-sm font-medium truncate transition-opacity duration-300', isOpen ? 'opacity-100' : 'opacity-0')}>
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
