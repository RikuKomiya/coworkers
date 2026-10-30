import type { ModelMessage } from "ai"
import { taskReply } from "@/lib/message-parts"

/**
 * Background tasks (start_task): the bot hands work to a helper, a BotAgent
 * of its own named `<botId>~<taskId>`, so the chat never waits on it. Pure
 * helpers, so they test without a Durable Object.
 */

const HELPER_SEPARATOR = "~"
const TASK_ID_PREFIX = "bg"

/** The helper's bot id, the part after `<userId>:` in its instance name. */
export function helperBotId(botId: string, taskId: string) {
  return `${botId}${HELPER_SEPARATOR}${taskId}`
}

/** The bot that started this helper, or null for a bot in the user's directory. */
export function parentBotIdOf(botId: string): string | null {
  const at = botId.indexOf(HELPER_SEPARATOR)
  return at > 0 ? botId.slice(0, at) : null
}

/**
 * Derived from the tool call, so a recovered turn that re-runs start_task
 * starts the same task instead of a second one. The prefix tells these apart
 * from delegate_task's ids in the shared delegations table.
 */
export function backgroundTaskId(toolCallId: string) {
  return `${TASK_ID_PREFIX}${toolCallId.replace(/[^a-zA-Z0-9]/g, "").slice(-24)}`
}

export function isBackgroundTaskId(id: string) {
  return id.startsWith(TASK_ID_PREFIX)
}

/**
 * Tools a helper does not get. It works alone on one task and is deleted
 * soon after, so: nothing that needs the user at the screen (cards), nothing
 * that hands work on, and nothing that changes the bot's lasting setup
 * (memory, skills, apps, routines, tracked items), which would vanish with
 * the helper. Its result goes to the main chat, which does those.
 */
export const HELPER_EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
  "start_task",
  "cancel_task",
  "update_task",
  "message_bot",
  "delegate_task",
  "schedule_routine",
  "update_routine",
  "list_routines",
  "cancel_routine",
  "ask_user",
  "request_handoff",
  "request_secret",
  "secret_request",
  "list_secrets",
  "set_name",
  "remember",
  "remember_for_all_bots",
  "save_skill",
  "start_teaching",
  "finish_teaching",
  "save_app",
  "list_apps",
  "delete_app",
  "app_data_list",
  "app_data_put",
  "app_data_delete",
  "track_item",
  "update_item",
  "resolve_item",
  "mark_reported",
  "was_reported",
])

/** A correction the user added to a running task (update_task). */
export interface TaskNote {
  /** The update_task call it came from, so a re-delivery is not added twice. */
  key: string
  text: string
}

function noteText(note: TaskNote) {
  return `[Update from the user while you were working]\n${note.text}`
}

function contains(message: ModelMessage, text: string) {
  if (message.role !== "user") return false
  return typeof message.content === "string"
    ? message.content.includes(text)
    : message.content.some((p) => p.type === "text" && p.text.includes(text))
}

/**
 * The step's messages with every note it does not have yet appended as a
 * user message, or null when nothing is missing. The AI SDK carries a
 * step's messages into the next step, so a note is added once per run; a
 * run started fresh (after a restart) gets them all again.
 */
export function withTaskNotes(
  messages: ModelMessage[],
  notes: TaskNote[]
): ModelMessage[] | null {
  const missing = notes
    .map(noteText)
    .filter((text) => !messages.some((m) => contains(m, text)))
  if (missing.length === 0) return null
  return [...messages, { role: "user", content: missing.join("\n\n") }]
}

/**
 * Ends the turn after a step that both acknowledged the user and called
 * start_task: the acknowledgment already streamed, so another model call would
 * only delay the next message. A step with no reply anywhere keeps going, so
 * the user still gets one.
 */
export function handedOff({
  steps,
}: {
  steps: readonly {
    text: string
    toolCalls: readonly { toolName: string; input: unknown }[]
  }[]
}) {
  const last = steps.at(-1)
  const handOffs =
    last?.toolCalls.filter((call) => call.toolName === "start_task") ?? []
  return (
    handOffs.length > 0 &&
    (!!last?.text.trim() || handOffs.some((call) => !!taskReply(call.input)))
  )
}
