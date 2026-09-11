import { serializeFlowFile, type FlowFile } from '../intent/flowFile.js'

/** Local HTML used by CI `run` so Chrome never depends on the public network. */
export const CLICK_GO_HTML =
  '<!doctype html><html lang="en"><head><title>Start</title></head><body>' +
  '<h1>Start</h1><button type="button" id="go">Go</button>' +
  '<script>document.getElementById("go").addEventListener("click",function(){' +
  'document.title="Done";document.querySelector("h1").textContent="Done";});</script>' +
  '</body></html>'

/** Durable click-go flow pointed at a live local origin. */
export function clickGoFlow(origin: string): FlowFile {
  return {
    version: 1,
    name: 'click-go',
    origin,
    steps: [
      { action: 'navigate', url: origin, expectText: 'Start' },
      { action: 'click', name: 'Go', expectText: 'Done' },
    ],
  }
}

/** Pretty JSON for the click-go flow. */
export function clickGoFlowJson(origin: string): string {
  return serializeFlowFile(clickGoFlow(origin))
}
