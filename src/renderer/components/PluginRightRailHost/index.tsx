import { useEffect, useState } from 'react'
import AvatarWidget from '../AvatarWidget'

type RightRailTarget = {
  pluginId: string
  widget: string
}

function pickFirstRightRailTarget(
  rows: Array<{ id: string; enabled: boolean; error?: string }>
): Promise<RightRailTarget | null> {
  return (async () => {
    for (const row of rows) {
      if (!row.enabled) continue
      if (row.error) continue
      const m = await window.electronAPI.plugins.getManifest(row.id)
      const ui = m && typeof m === 'object' ? (m as any).ui : null
      const panels = Array.isArray(ui?.rightRailPanels) ? ui.rightRailPanels : []
      const first = panels.find((p: any) => p && typeof p.widget === 'string')
      if (first) {
        return { pluginId: row.id, widget: String(first.widget) }
      }
    }
    return null
  })()
}

export default function PluginRightRailHost() {
  const [target, setTarget] = useState<RightRailTarget | null>(null)

  useEffect(() => {
    let mounted = true
    const refresh = async () => {
      try {
        const list = await window.electronAPI.plugins.list()
        const picked = await pickFirstRightRailTarget(
          list.map((x: any) => ({
            id: String(x.id),
            enabled: !!x.enabled,
            error: typeof x.error === 'string' ? x.error : undefined,
          }))
        )
        if (!mounted) return
        setTarget(picked)
      } catch {
        if (!mounted) return
        setTarget(null)
      }
    }
    void refresh()
    const off = window.electronAPI.plugins.onPreferencesChanged?.(() => {
      void refresh()
    })
    return () => {
      mounted = false
      off?.()
    }
  }, [])

  if (!target) return null
  if (target.widget === 'AvatarWidget') {
    return <AvatarWidget pluginId={target.pluginId} />
  }
  return null
}
