/**
 * 从 localStorage 读取 JSON 反序列化后的值。
 * 读取失败或 key 不存在时返回 `defaultValue`。
 */
export function getStorageItem<T>(key: string, defaultValue: T): T {
  try {
    const saved = localStorage.getItem(key)
    return saved ? JSON.parse(saved) : defaultValue
  } catch {
    // TODO: 接入统一日志总线后在此处上报错误
    return defaultValue
  }
}

/**
 * 将值 JSON 序列化后写入 localStorage。
 * 写入失败（如配额超限）静默处理，不抛到上层。
 */
export function setStorageItem<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // TODO: 接入统一日志总线后在此处上报错误
  }
}

/**
 * 从 localStorage 删除指定 key。
 */
export function removeStorageItem(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // TODO: 接入统一日志总线后在此处上报错误
  }
}

/**
 * 清空整个 localStorage。
 * 谨慎调用，会清除所有应用数据。
 */
export function clearStorage(): void {
  try {
    localStorage.clear()
  } catch {
    // TODO: 接入统一日志总线后在此处上报错误
  }
}
