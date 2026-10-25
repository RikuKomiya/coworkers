import { useCallback, useEffect, useLayoutEffect, useRef } from "react"

/** How fast the scroll catches up with new content (time constant, ms). */
const CATCH_UP_MS = 70
/** This close to the bottom still counts as reading the latest. */
const NEAR_BOTTOM_PX = 80

/**
 * Keeps a scroller at its bottom while content grows (new messages,
 * streaming text, cards that expand), gliding there instead of jumping.
 * Scrolling up stops it; scrolling back near the bottom resumes it.
 *
 * One animation frame loop chases a moving target, so a stream of small
 * height changes reads as one continuous glide instead of restarting a
 * fixed-length tween on every token. Content size is watched with a
 * ResizeObserver, so nothing has to call it on each render.
 */
export function useFollowBottom() {
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const frame = useRef(0)
  /** Where we last left scrollTop. Anything above it was the user. */
  const lastTop = useRef(0)

  const follow = useCallback(() => {
    const el = scroller.current
    if (!el || !pinned.current || frame.current) return
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.scrollTop = el.scrollHeight
      lastTop.current = el.scrollTop
      return
    }
    // scrollTop snaps to device pixels, so keep the exact position here.
    let position = el.scrollTop
    // A frame's timestamp can predate this call, so time starts at frame one.
    let last = 0
    const step = (now: number) => {
      const target = el.scrollHeight - el.clientHeight
      if (!pinned.current || target - position < 1) {
        if (pinned.current) el.scrollTop = target
        lastTop.current = el.scrollTop
        frame.current = 0
        return
      }
      const dt = last ? Math.min(now - last, 50) : 1000 / 60
      last = now
      position += (target - position) * (1 - Math.exp(-dt / CATCH_UP_MS))
      el.scrollTop = position
      lastTop.current = el.scrollTop
      frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }, [])

  /** Jump back to following, e.g. after the user sends a message. */
  const pin = useCallback(() => {
    pinned.current = true
    follow()
  }, [follow])

  const onScroll = useCallback(() => {
    const el = scroller.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) {
      pinned.current = true
    } else if (el.scrollTop < lastTop.current - 1) {
      pinned.current = false
    }
    lastTop.current = el.scrollTop
  }, [])

  // History opens at the bottom, before the first paint.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    lastTop.current = el.scrollTop
  }, [])

  useEffect(() => {
    const observer = new ResizeObserver(follow)
    if (scroller.current) observer.observe(scroller.current)
    if (content.current) observer.observe(content.current)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [follow])

  return { scroller, content, onScroll, pin }
}
