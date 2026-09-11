import { originAllowed, type EngineSettings } from './settings.js'

/** Outcome of the attach gate for one origin. */
export type AttachDecision = 'allow' | 'deny' | 'prompt'

/** Decide whether chrome.debugger may attach to this origin. */
export function decideAttach(settings: EngineSettings, origin: string | undefined): AttachDecision {
  if (settings.paused) {
    return 'deny'
  }
  if (settings.attachPolicy === 'always') {
    return 'allow'
  }
  if (settings.attachPolicy === 'prompt') {
    return 'prompt'
  }
  if (origin !== undefined && originAllowed(origin, settings.allowedOrigins)) {
    return 'allow'
  }
  return 'prompt'
}
