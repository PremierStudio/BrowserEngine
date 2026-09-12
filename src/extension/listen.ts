import { mkdirSync, unlinkSync } from 'node:fs'
import net from 'node:net'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createExtensionBridge } from './bridge.js'

/** Default Unix socket the native host dials. */
export function defaultExtensionSocketPath(): string {
  return join(homedir(), '.local/share/browser-engine/native.sock')
}

/** Listen for one native-host relay and return an RPC bridge. */
export function listenExtensionSocket(sockPath: string = defaultExtensionSocketPath()) {
  mkdirSync(dirname(sockPath), { recursive: true })
  try {
    unlinkSync(sockPath)
  } catch {
    // first run
  }
  let conn: net.Socket | undefined
  const bridge = createExtensionBridge({
    write: (line) => {
      conn?.write(`${line}\n`)
    },
  })
  const server = net.createServer((socket) => {
    conn = socket
    let buf = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buf += chunk
      const parts = buf.split('\n')
      buf = parts.pop() || ''
      for (const part of parts) {
        if (part !== '') {
          bridge.receive(part)
        }
      }
    })
    socket.on('close', () => {
      if (conn === socket) {
        conn = undefined
        bridge.rejectAll?.(new Error('extension disconnected'))
      }
    })
  })
  server.listen(sockPath)
  return {
    bridge,
    close: () => {
      bridge.rejectAll?.(new Error('extension disconnected'))
      conn?.destroy()
      server.close()
      try {
        unlinkSync(sockPath)
      } catch {
        // gone
      }
    },
  }
}
