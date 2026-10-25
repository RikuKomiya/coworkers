/**
 * The last frame of the bot's browser after each browser_execute step: the
 * page it ended on and a small screenshot. The Computer card shows it once
 * the step is over, so a finished card shows what the bot saw instead of a
 * Live View of whatever tab is left (often the session's blank first tab).
 *
 * `frameCode` returns code for the browser Code Mode runtime, which has a
 * `cdp` connector (`cdp.send`, `cdp.attachToTarget`).
 */

/** A tab as the previous frame left it, to tell which one the bot just used. */
export interface SeenTab {
  targetId: string
  url: string
}

export interface FrameResult {
  /** Shaped like a browser screenshot so the runtime keeps `data` intact. */
  type: "browser_screenshot"
  mediaType: "image/jpeg"
  data: string
  targetId: string
  url: string
  title: string
  tabs: SeenTab[]
}

/**
 * Pick the bot's tab and capture it. The bot's tab is the one that opened or
 * moved since the last frame, else the one shown last time, else the newest.
 * Blank tabs are never the answer: every new session starts with one.
 */
export function frameCode(seen: SeenTab[], lastTarget: string | undefined) {
  return `async () => {
  const SEEN = ${JSON.stringify(seen)};
  const LAST = ${JSON.stringify(lastTarget ?? "")};
  const { targetInfos } = await cdp.send({ method: "Target.getTargets" });
  const pages = targetInfos.filter(
    (t) => t.type === "page" && t.url && t.url !== "about:blank" && !t.url.startsWith("chrome")
  );
  if (!pages.length) return null;
  const moved = pages.filter(
    (t) => !SEEN.some((s) => s.targetId === t.targetId && s.url === t.url)
  );
  const target =
    moved.at(-1) || pages.find((t) => t.targetId === LAST) || pages.at(-1);
  const { sessionId } = await cdp.attachToTarget({ targetId: target.targetId });
  const shot = await cdp.send({
    method: "Page.captureScreenshot",
    params: { format: "jpeg", quality: 55 },
    sessionId,
  });
  return {
    type: "browser_screenshot",
    mediaType: "image/jpeg",
    data: shot.data,
    targetId: target.targetId,
    url: target.url,
    title: target.title || "",
    tabs: pages.map((t) => ({ targetId: t.targetId, url: t.url })),
  };
}`
}

export type BrowserNav = "back" | "forward" | "reload"

/**
 * Move the bot's tab for the user's own browser buttons: back, forward or
 * reload. Acts on the tab the last frame showed, else the first real page.
 */
export function navCode(action: BrowserNav, lastTarget: string | undefined) {
  return `async () => {
  const ACTION = ${JSON.stringify(action)};
  const LAST = ${JSON.stringify(lastTarget ?? "")};
  const { targetInfos } = await cdp.send({ method: "Target.getTargets" });
  const pages = targetInfos.filter((t) => t.type === "page");
  const target =
    pages.find((t) => t.targetId === LAST) ||
    pages.find((t) => t.url !== "about:blank") ||
    pages[0];
  if (!target) return { moved: false };
  const { sessionId } = await cdp.attachToTarget({ targetId: target.targetId });
  if (ACTION === "reload") {
    await cdp.send({ method: "Page.reload", sessionId });
    return { moved: true };
  }
  const { currentIndex, entries } = await cdp.send({ method: "Page.getNavigationHistory", sessionId });
  const entry = entries[currentIndex + (ACTION === "back" ? -1 : 1)];
  if (!entry) return { moved: false };
  await cdp.send({ method: "Page.navigateToHistoryEntry", params: { entryId: entry.id }, sessionId });
  return { moved: true };
}`
}
