import { useState, useEffect } from 'react'

/**
 * localStorage 读写 hook。
 * 返回 `[value, setValue]`，写入时自动 JSON 序列化并持久化。
 * 读取失败时静默回退 defaultValue。
 *
 * TODO: 接入统一通知系统后在此处上报 JSON 解析失败。
 */
export function useStorage<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key)
      return saved ? JSON.parse(saved) : defaultValue
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // TODO: 接入统一通知系统后在此处上报存储失败
    }
  }, [key, value])

  return [value, setValue]
}
