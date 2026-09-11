export {}

declare global {
  interface Window {
    __browserEngineHud?: {
      setState(state: 'active' | 'paused' | 'off'): void
      destroy(): void
    }
  }
}
