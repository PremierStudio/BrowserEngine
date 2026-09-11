import { INSTALL_RESIZE_LISTENER } from '../browser/resizeBridge.js'
import { parseWindowLayout, WindowLayoutTracker } from '../browser/windowLayout.js'
import type { SnapshotNode } from '../snapshot/a11ySnapshot.js'
import type { Overlay } from '../snapshot/overlay.js'
import {
  clickUid,
  hoverUid,
  navigateTo,
  pressKey,
  scrollUid,
  selectUid,
  typeUid,
} from './actOnPage.js'
import { getPageDialog, DialogTracker } from './dialogPage.js'
import { emulatePage } from './emulatePage.js'
import { followWindowIfResized } from './followWindow.js'
import { observePage } from './observePage.js'
import type { BrowserEvent } from '../events/types.js'
import type { PageState } from './observeExtras.js'
import { resolveUid } from './resolveUid.js'
import { createActionWaiter, memoryMutationSource } from './waitAfterAction.js'
import type { MutationSource } from '../actions/StabilityWaiter.js'

/** The result of observing a page. */
export interface ObserveResult {
  snapshot: SnapshotNode
  image: string
  overlay: Overlay
  pageState: PageState
  events?: readonly BrowserEvent[]
}

/** Optional waiter wiring for tests and the live MutationObserver. */
interface ContextPageOptions {
  mutations?: MutationSource & { emit: () => void }
  clock?: () => number
  sleep?: (ms: number) => Promise<void>
  quietPeriod?: number
  timeout?: number
  typeCharMs?: number
}

/** A narrow contract that hides Puppeteer behind a testable interface. */
export interface ContextPage {
  getElementByUid(uid: string): Promise<unknown>
  waitForEventsAfterAction(): Promise<void>
  observe(): Promise<ObserveResult>
  emulate(options: unknown): Promise<void>
  getDialog(): Promise<unknown>
  click(uid: string): Promise<void>
  type(uid: string, text: string): Promise<void>
  hover(uid: string): Promise<void>
  scroll(uid: string, dx: number, dy: number): Promise<void>
  select(uid: string, value: string): Promise<void>
  press(key: string): Promise<void>
  navigate(url: string): Promise<void>
}

/** A minimal structural view of the Puppeteer Page we depend on. */
export interface PageLike {
  accessibility: {
    snapshot: () => Promise<unknown>
  }
  cdp: (session: string, method: string, params?: unknown) => Promise<unknown>
  screenshot: (opts?: unknown) => Promise<string>
  evaluate: (fn: string, arg?: unknown) => Promise<unknown>
  goto: (url: string) => Promise<void>
  keyboardPress: (key: string) => Promise<void>
}

/**
 * A Puppeteer-backed ContextPage. Tools never touch the raw Puppeteer Page
 * directly; they go through this narrow contract.
 */
export class PuppeteerContextPage implements ContextPage {
  private readonly page: PageLike
  private readonly waitAfter: { wait: () => Promise<boolean> }
  private readonly mutations: MutationSource & { emit: () => void }
  private readonly dialogs = new DialogTracker()
  private readonly layout = new WindowLayoutTracker()
  private readonly typeCharMs: number | undefined
  private readonly sleep: ((ms: number) => Promise<void>) | undefined

  constructor(page: PageLike, options: ContextPageOptions = {}) {
    this.page = page
    this.mutations = options.mutations ?? memoryMutationSource()
    this.typeCharMs = options.typeCharMs
    this.sleep = options.sleep
    this.waitAfter = createActionWaiter(this.mutations, {
      quietPeriod: options.quietPeriod ?? 50,
      timeout: options.timeout ?? 1000,
      clock: options.clock,
      sleep: options.sleep,
    })
  }

  /** Records a live DOM mutation so the act-then-wait quiet period restarts. */
  notifyMutation(): void {
    this.mutations.emit()
  }

  /** Records a javascript-dialog opening from the page event stream. */
  onDialogOpening(payload: unknown): void {
    this.dialogs.onOpening(payload)
  }

  async getElementByUid(uid: string): Promise<unknown> {
    return resolveUid(this.page, uid)
  }

  async waitForEventsAfterAction(): Promise<void> {
    await this.waitAfter.wait()
  }

  async observe(): Promise<ObserveResult> {
    const result = await observePage(this.page)
    await this.page.evaluate(INSTALL_RESIZE_LISTENER)
    const resized = await followWindowIfResized(this.page, this.layout, result.pageState.layout)
    if (result.pageState.layout === undefined) {
      return result
    }
    return { ...result, pageState: { ...result.pageState, resized } }
  }

  /** Live headed resize: follow the new window, never snap back. */
  async noteResize(payload: unknown): Promise<void> {
    const parsed = parseWindowLayout(payload)
    const resized = await followWindowIfResized(this.page, this.layout, parsed)
    if (resized) {
      this.mutations.emit()
    }
  }

  async emulate(options: unknown): Promise<void> {
    await emulatePage(this.page, options)
  }

  async getDialog(): Promise<unknown> {
    return getPageDialog(this.dialogs)
  }

  async click(uid: string): Promise<void> {
    await clickUid(this.page, uid)
  }

  async type(uid: string, text: string): Promise<void> {
    const typeOptions = { charMs: this.typeCharMs, sleep: this.sleep }
    await typeUid(this.page, uid, text, typeOptions)
  }

  async hover(uid: string): Promise<void> {
    await hoverUid(this.page, uid)
  }

  async scroll(uid: string, dx: number, dy: number): Promise<void> {
    await scrollUid(this.page, uid, dx, dy)
  }

  async select(uid: string, value: string): Promise<void> {
    await selectUid(this.page, uid, value)
  }

  async press(key: string): Promise<void> {
    await pressKey(this.page, key)
  }

  async navigate(url: string): Promise<void> {
    await navigateTo(this.page, url)
  }
}
