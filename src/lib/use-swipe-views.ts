import { useEffect, useRef } from "react"

/** Travel past this share of the width, or flick faster than this, to switch. */
const COMMIT_SHARE = 0.3
const COMMIT_VELOCITY = 0.4 // px/ms
/** Movement before a touch picks an axis. */
const AXIS_SLOP = 8
/** Horizontal trackpad scroll that switches views. */
const WHEEL_THRESHOLD = 60
/** Quiet time that ends a trackpad gesture, momentum included. */
const WHEEL_IDLE_MS = 220

/**
 * Swipe between side-by-side views. A touch follows the finger and snaps
 * to the nearer view on release; a horizontal trackpad scroll switches once
 * per gesture. Vertical scrolling inside a view is left to the browser.
 *
 * The viewport is the element that receives the gestures; the track is the
 * strip of views that moves. Writes `--drag` (px) and `data-dragging` on the
 * track while a finger is down, so CSS can follow it without a transition.
 */
export function useSwipeViews({
  index,
  count,
  onChange,
}: {
  index: number
  count: number
  onChange: (index: number) => void
}) {
  const viewportRef = useRef<HTMLElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const latest = useRef({ index, count, onChange })
  latest.current = { index, count, onChange }

  useEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return

    function go(step: number) {
      const { index, count, onChange } = latest.current
      const next = Math.min(count - 1, Math.max(0, index + step))
      if (next !== index) onChange(next)
    }

    // ── Touch and pen ──
    let touch: {
      id: number
      x: number
      y: number
      axis: "x" | "y" | null
      dx: number
      lastX: number
      lastT: number
      velocity: number
    } | null = null
    // A drag that ends over a link must not also open it.
    let swallowClick = false

    function setDrag(px: number) {
      track!.style.setProperty("--drag", `${px}px`)
    }

    function onPointerDown(e: PointerEvent) {
      if (e.pointerType === "mouse" || !e.isPrimary) return
      touch = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        axis: null,
        dx: 0,
        lastX: e.clientX,
        lastT: e.timeStamp,
        velocity: 0,
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (!touch || e.pointerId !== touch.id) return
      const dx = e.clientX - touch.x
      const dy = e.clientY - touch.y
      if (!touch.axis) {
        if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) return
        touch.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y"
        if (touch.axis === "y") return
        viewport!.setPointerCapture(e.pointerId)
        track!.dataset.dragging = ""
      }
      if (touch.axis !== "x") return
      const { index, count } = latest.current
      // Resist past the first and last view.
      const atEdge = (index === 0 && dx > 0) || (index === count - 1 && dx < 0)
      touch.dx = atEdge ? dx / 3 : dx
      const dt = e.timeStamp - touch.lastT
      if (dt > 0) touch.velocity = (e.clientX - touch.lastX) / dt
      touch.lastX = e.clientX
      touch.lastT = e.timeStamp
      setDrag(touch.dx)
    }

    function onPointerEnd(e: PointerEvent) {
      if (!touch || e.pointerId !== touch.id) return
      const { axis, dx, velocity } = touch
      touch = null
      if (axis !== "x") return
      delete track!.dataset.dragging
      setDrag(0)
      if (e.type === "pointerup") {
        // The click, if any, fires right after pointerup.
        swallowClick = true
        setTimeout(() => (swallowClick = false), 0)
      }
      const fast = Math.abs(velocity) > COMMIT_VELOCITY
      const forward = Math.sign(velocity) === Math.sign(dx)
      const far = Math.abs(dx) > viewport!.clientWidth * COMMIT_SHARE
      // A flick back toward the start cancels, however far the drag got.
      if (fast ? forward : far) go(dx < 0 ? 1 : -1)
    }

    function onClick(e: MouseEvent) {
      if (!swallowClick) return
      swallowClick = false
      e.preventDefault()
      e.stopPropagation()
    }

    // ── Trackpad ──
    let wheelTotal = 0
    let wheelSpent = false
    let wheelTimer: ReturnType<typeof setTimeout> | undefined

    function onWheel(e: WheelEvent) {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
      // Nothing in the sidebar scrolls sideways; keep the browser from
      // reading this as back/forward.
      e.preventDefault()
      clearTimeout(wheelTimer)
      wheelTimer = setTimeout(() => {
        wheelTotal = 0
        wheelSpent = false
      }, WHEEL_IDLE_MS)
      if (wheelSpent) return
      wheelTotal += e.deltaX
      if (Math.abs(wheelTotal) < WHEEL_THRESHOLD) return
      wheelSpent = true
      go(wheelTotal > 0 ? 1 : -1)
    }

    viewport.addEventListener("pointerdown", onPointerDown)
    viewport.addEventListener("pointermove", onPointerMove)
    viewport.addEventListener("pointerup", onPointerEnd)
    viewport.addEventListener("pointercancel", onPointerEnd)
    viewport.addEventListener("click", onClick, true)
    viewport.addEventListener("wheel", onWheel, { passive: false })
    return () => {
      clearTimeout(wheelTimer)
      viewport.removeEventListener("pointerdown", onPointerDown)
      viewport.removeEventListener("pointermove", onPointerMove)
      viewport.removeEventListener("pointerup", onPointerEnd)
      viewport.removeEventListener("pointercancel", onPointerEnd)
      viewport.removeEventListener("click", onClick, true)
      viewport.removeEventListener("wheel", onWheel)
    }
  }, [])

  return { viewportRef, trackRef }
}
