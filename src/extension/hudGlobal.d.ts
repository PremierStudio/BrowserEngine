export {}
declare global {
  interface Window {
    __browserEngineHud?: {
      handle(event: unknown): void
      setState(state: 'active' | 'paused' | 'off'): void
      destroy(): void
    }
  }
}
