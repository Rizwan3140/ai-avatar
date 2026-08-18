import { useEffect, useState } from 'react'
import config from '../renderer/renderer.config.ts'

/**
 * A transparent OLED running for months will permanently ghost anything that
 * never moves — the wordmark and the two controls are the only such elements
 * here. Drifting them a few pixels on a slow cycle is imperceptible to a visitor
 * and is the difference between a panel that survives a year and one that does
 * not. Hardware constraint, not a preference.
 */
export function useBurnInShift() {
  const [shift, setShift] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const d = config.burnInShift
    const positions = [
      { x: 0, y: 0 },
      { x: d, y: 0 },
      { x: d, y: d },
      { x: 0, y: d },
      { x: -d, y: d },
      { x: -d, y: 0 },
      { x: -d, y: -d },
      { x: 0, y: -d },
      { x: d, y: -d },
    ]
    let i = 0
    const timer = setInterval(() => {
      i = (i + 1) % positions.length
      setShift(positions[i])
    }, config.burnInInterval)
    return () => clearInterval(timer)
  }, [])

  return shift
}
