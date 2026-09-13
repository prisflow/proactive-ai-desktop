/**
 * 数据协议层：插件状态的类型定义与读写维护。
 * 职责：状态结构定义、持久化读写、按会话分键。禁止展示逻辑。
 */
function createLedger(api) {
  /**
   * 状态结构（数据契约——字段变更需考虑旧存档兼容）。
   * TODO: 定义你的领域状态字段。
   */
  function newState() {
    return {
      createdAt: Date.now(),
    }
  }

  const worlds = new Map() // 会话 ID → 状态

  return {
    /** 读取（或创建）当前会话的状态。 */
    get(cid) {
      if (!worlds.has(cid)) worlds.set(cid, newState())
      return worlds.get(cid)
    },
    /** 持久化到插件存储。 */
    saveAll() {
      const data = {}
      for (const [cid, w] of worlds) data[cid] = w
      api.storage.set(data)
    },
    /** 从存储恢复（插件装载时调用）。 */
    load() {
      const saved = api.storage.get()
      if (saved && typeof saved === 'object') {
        for (const [cid, w] of Object.entries(saved)) worlds.set(cid, w)
      }
    },
  }
}

module.exports = { createLedger }
