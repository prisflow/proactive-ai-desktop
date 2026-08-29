import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Tailwind CSS 类名合并工具。
 * 先用 clsx 处理条件类名，再用 twMerge 合并冲突类（如冲突的 padding）。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
