import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

/** useState mirrored into localStorage (silently skipped if storage is full or blocked). */
export function usePersistent<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? ({ ...initial, ...JSON.parse(raw) } as T) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* quota or privacy mode: keep working without persistence */
    }
  }, [key, value])
  return [value, setValue]
}
