import { useCallback, useEffect, useRef, useState } from "react"
import type { Room } from "livekit-client"
import { Loader } from "@cloudflare/kumo/components/loader"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import { CallEndIcon, CallIcon } from "@/components/icons"
import { startVoiceCall } from "@/lib/server-fns"
import type { VoiceStatus, VoiceView } from "@/lib/types"

type Phase =
  | { kind: "idle"; error?: string }
  | { kind: "connecting" }
  | { kind: "live"; callId: string; room: Room }

/**
 * A voice call from the browser's side: join the call's LiveKit room, send
 * the mic, play the voice agent. What the bot is doing comes from
 * `BotState.voice`, which the bot keeps up to date.
 */
export function useVoiceCall(
  botId: string,
  hangUpOnBot: (callId: string) => Promise<void>
) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const end = useCallback(
    async (error?: string) => {
      const current = phaseRef.current
      setPhase({ kind: "idle", error })
      if (current.kind !== "live") return
      await current.room.disconnect()
      await hangUpOnBot(current.callId).catch(() => {})
    },
    [hangUpOnBot]
  )

  const start = useCallback(async () => {
    if (phaseRef.current.kind !== "idle") return
    setPhase({ kind: "connecting" })
    try {
      // Loaded on the first call: it is browser-only and not small.
      const { Room, RoomEvent, Track } = await import("livekit-client")
      const call = await startVoiceCall({ data: botId })
      const room = new Room({ adaptiveStream: true, dynacast: true })
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio)
          document.body.appendChild(track.attach())
      })
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        for (const el of track.detach()) el.remove()
      })
      room.on(RoomEvent.Disconnected, () => {
        if (phaseRef.current.kind === "live") void end()
      })
      await room.connect(call.serverUrl, call.participantToken)
      // Inside the click that started the call, so autoplay is allowed.
      await room.startAudio()
      await room.localParticipant.setMicrophoneEnabled(true)
      setPhase({ kind: "live", callId: call.callId, room })
    } catch (err) {
      setPhase({
        kind: "idle",
        error: err instanceof Error ? err.message : "The call did not connect.",
      })
    }
  }, [botId, end])

  // Leaving the bot ends the call.
  useEffect(() => () => void end(), [end])

  return { phase, start, hangUp: () => void end() }
}

export function CallButton({
  phase,
  onStart,
  onHangUp,
}: {
  phase: Phase
  onStart: () => void
  onHangUp: () => void
}) {
  const live = phase.kind === "live"
  const label = live ? "Hang up" : "Call"
  return (
    <Tooltip
      content={label}
      render={
        <button
          type="button"
          aria-label={label}
          aria-pressed={live}
          disabled={phase.kind === "connecting"}
          onClick={live ? onHangUp : onStart}
          className={live ? "icon-btn text-kumo-danger!" : "icon-btn"}
        >
          {phase.kind === "connecting" ? (
            <Loader size="sm" />
          ) : live ? (
            <CallEndIcon size={20} />
          ) : (
            <CallIcon size={20} />
          )}
        </button>
      }
    />
  )
}

const STATUS_LABEL: Record<VoiceStatus, string> = {
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
}

/** Above the composer while a call is on: what the bot is doing and what it hears. */
export function CallBar({
  phase,
  view,
  onHangUp,
}: {
  phase: Phase
  view: VoiceView | null | undefined
  onHangUp: () => void
}) {
  if (phase.kind === "idle") {
    return phase.error ? (
      <p
        role="alert"
        className="mx-auto w-full max-w-[820px] px-6 pb-2 text-sm text-kumo-danger"
      >
        {phase.error}
      </p>
    ) : null
  }
  const status =
    phase.kind === "connecting"
      ? "Connecting"
      : view
        ? STATUS_LABEL[view.status]
        : "Waiting for the bot"
  return (
    <div className="mx-auto w-full max-w-[820px] px-6 pb-2">
      <div
        aria-live="polite"
        className="msg-enter flex min-w-0 items-center gap-2.5 rounded-2xl bg-kumo-tint py-1.5 pr-1.5 pl-3 text-sm"
      >
        <span
          aria-hidden
          className={`size-2 shrink-0 rounded-full ${view?.status === "speaking" ? "animate-pulse bg-kumo-brand" : "bg-kumo-success"}`}
        />
        <span className="shrink-0 font-medium text-kumo-default">{status}</span>
        <span className="min-w-0 flex-1 truncate text-kumo-subtle">
          {view?.partial}
        </span>
        <Tooltip
          content="Hang up"
          render={
            <button
              type="button"
              aria-label="Hang up"
              onClick={onHangUp}
              className="icon-btn size-7 text-kumo-danger!"
            >
              <CallEndIcon size={14} />
            </button>
          }
        />
      </div>
    </div>
  )
}
