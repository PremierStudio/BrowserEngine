import {
  clickHudDeclaration,
  hoverHudDeclaration,
  pressHudEvaluate,
  scrollHudDeclaration,
  selectHudDeclaration,
  typeHudCharDeclaration,
  typeHudCommitDeclaration,
  typeHudFocusDeclaration,
} from '../browser/actionHud.js'
import { argvHasHeaded } from '../browser/launchOptions.js'
import type { PageLike } from './ContextPage.js'
import { parseUid } from '../uid.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function objectIdFrom(result: unknown): string {
  if (!isRecord(result) || !isRecord(result.object) || typeof result.object.objectId !== 'string') {
    throw new Error('Failed to resolve element')
  }
  return result.object.objectId
}

async function resolveObjectId(page: PageLike, uid: string): Promise<string> {
  const parts = parseUid(uid)
  if (parts === null) {
    throw new Error(`Invalid uid: ${uid}`)
  }
  const resolved = await page.cdp('page', 'DOM.resolveNode', { backendNodeId: parts.backendNodeId })
  return objectIdFrom(resolved)
}

async function callOn(
  page: PageLike,
  objectId: string,
  functionDeclaration: string,
): Promise<void> {
  await page.cdp('page', 'Runtime.callFunctionOn', { objectId, functionDeclaration })
}

/** Clicks the element identified by uid via CDP resolve + callFunctionOn. */
export async function clickUid(page: PageLike, uid: string): Promise<void> {
  const objectId = await resolveObjectId(page, uid)
  await callOn(page, objectId, clickHudDeclaration())
}

/** Snappy per-key delay in headed mode. Readable, not hunt-and-peck. */
export const HUMAN_TYPE_MS = 28

export type TypeOptions = {
  charMs?: number
  sleep?: (ms: number) => Promise<void>
}

/** Visible window types like a person. Headless dumps instantly. */
export function typeCharMs(
  env: Record<string, string | undefined>,
  argv?: readonly string[],
): number {
  const parsed = Number(env.BROWSER_ENGINE_TYPE_MS)
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed
  }
  if (env.BROWSER_ENGINE_HEADED === '0' && !argvHasHeaded(argv)) {
    return 0
  }
  return HUMAN_TYPE_MS
}

/** Types text into the element identified by uid, one character at a time. */
export async function typeUid(
  page: PageLike,
  uid: string,
  text: string,
  options: TypeOptions = {},
): Promise<void> {
  const objectId = await resolveObjectId(page, uid)
  await callOn(page, objectId, typeHudFocusDeclaration())
  const charMs = options.charMs ?? 0
  for (const character of text) {
    await callOn(page, objectId, typeHudCharDeclaration(character))
    if (charMs > 0 && options.sleep !== undefined) {
      await options.sleep(charMs)
    }
  }
  await callOn(page, objectId, typeHudCommitDeclaration())
}

/** Hovers the element identified by uid. */
export async function hoverUid(page: PageLike, uid: string): Promise<void> {
  const objectId = await resolveObjectId(page, uid)
  await callOn(page, objectId, hoverHudDeclaration())
}

/** Scrolls within the element identified by uid. */
export async function scrollUid(
  page: PageLike,
  uid: string,
  dx: number,
  dy: number,
): Promise<void> {
  const objectId = await resolveObjectId(page, uid)
  await callOn(page, objectId, scrollHudDeclaration(dx, dy))
}

/** Selects a value on the element identified by uid. */
export async function selectUid(page: PageLike, uid: string, value: string): Promise<void> {
  const objectId = await resolveObjectId(page, uid)
  await callOn(page, objectId, selectHudDeclaration(value))
}

/** Presses a key on the page. */
export async function pressKey(page: PageLike, key: string): Promise<void> {
  await page.evaluate(pressHudEvaluate(key))
  await page.keyboardPress(key)
}

/** Navigates the page to a URL. */
export async function navigateTo(page: PageLike, url: string): Promise<void> {
  await page.goto(url)
}
