/** Methods the unpacked extension understands. */
export type ExtensionMethod =
  | 'ping'
  | 'tabs'
  | 'attach'
  | 'detach'
  | 'cdp'
  | 'evaluate'
  | 'goto'
  | 'status'
  | 'settings'
  | 'allow'
  | 'deny'
  | 'pause'
  | 'tab_create'
  | 'tab_close'
  | 'tab_activate'
  | 'activity'

/** A request from the engine to the extension. */
export type ExtensionRequest = {
  id: string
  method: ExtensionMethod
  params?: Record<string, unknown>
}

/** A reply from the extension. */
export type ExtensionResponse = {
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const METHODS: readonly ExtensionMethod[] = [
  'ping',
  'tabs',
  'attach',
  'detach',
  'cdp',
  'evaluate',
  'goto',
  'status',
  'settings',
  'allow',
  'deny',
  'pause',
  'tab_create',
  'tab_close',
  'tab_activate',
  'activity',
]

function asMethod(value: unknown): ExtensionMethod | undefined {
  for (const method of METHODS) {
    if (method === value) {
      return method
    }
  }
  return undefined
}

/** Serialize a request for the native / socket pipe. */
export function encodeRequest(request: ExtensionRequest): string {
  return JSON.stringify(request)
}

/** Serialize a response for the native / socket pipe. */
export function encodeResponse(response: ExtensionResponse): string {
  return JSON.stringify(response)
}

/** Parse a request. Throws when id/method are missing or unknown. */
export function parseRequest(raw: string): ExtensionRequest {
  const value: unknown = JSON.parse(raw)
  if (!isRecord(value) || typeof value.id !== 'string' || value.id === '') {
    throw new Error('extension request missing id')
  }
  const method = asMethod(value.method)
  if (method === undefined) {
    throw new Error('extension request missing method')
  }
  const request: ExtensionRequest = {
    id: value.id,
    method,
  }
  if (isRecord(value.params)) {
    request.params = value.params
  }
  return request
}

/** Parse a response. Throws when id is missing. */
export function parseResponse(raw: string): ExtensionResponse {
  const value: unknown = JSON.parse(raw)
  if (!isRecord(value) || typeof value.id !== 'string' || value.id === '') {
    throw new Error('extension response missing id')
  }
  const response: ExtensionResponse = {
    id: value.id,
    ok: value.ok === true,
  }
  if (value.result !== undefined) {
    response.result = value.result
  }
  if (typeof value.error === 'string') {
    response.error = value.error
  }
  return response
}
