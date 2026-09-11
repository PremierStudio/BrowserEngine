/** Chrome native messaging: 4-byte LE length + UTF-8 JSON. */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Array.isArray(value) === false
}

/** Encode one native-messaging frame. */
export function encodeNativeMessage(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length, 0)
  return Buffer.concat([header, body])
}

/** Decode zero or more complete frames. Returns leftover incomplete bytes. */
export function decodeNativeMessages(buffer: Buffer): {
  messages: Record<string, unknown>[]
  rest: Buffer
} {
  const messages: Record<string, unknown>[] = []
  let offset = 0
  while (offset + 4 <= buffer.length) {
    const size = buffer.readUInt32LE(offset)
    if (offset + 4 + size > buffer.length) {
      break
    }
    const raw = buffer.subarray(offset + 4, offset + 4 + size).toString('utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) {
      throw new Error('native message must be an object')
    }
    messages.push(parsed)
    offset += 4 + size
  }
  return { messages, rest: buffer.subarray(offset) }
}
