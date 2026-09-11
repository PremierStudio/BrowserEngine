<p align="center">
  <img alt="BrowserEngine" src="https://raw.githubusercontent.com/PremierStudio/BrowserEngine/master/docs/banner.svg" width="90%"/>
</p>

<p align="center">
  An agent explores the product. CI replays the path with no AI.
  A broken step is a named report. Your tools decide ticket or heal.
</p>

<p align="center">
  <a href="https://github.com/PremierStudio/BrowserEngine/blob/master/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"/></a>
  <a href="https://github.com/PremierStudio/BrowserEngine/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/PremierStudio/BrowserEngine/ci.yml?branch=master&label=CI&logo=github"/></a>
  <a href="https://github.com/PremierStudio/BrowserEngine"><img alt="Coverage" src="https://img.shields.io/badge/coverage-100%25-brightgreen.svg"/></a>
  <a href="https://github.com/PremierStudio/BrowserEngine"><img alt="Mutation score" src="https://img.shields.io/badge/mutation-100%25-success.svg"/></a>
  <a href="https://github.com/PremierStudio/BrowserEngine"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6.0-blue.svg?logo=typescript&logoColor=white"/></a>
  <a href="https://pptr.dev"><img alt="Puppeteer" src="https://img.shields.io/badge/Puppeteer-25-green.svg?logo=puppeteer&logoColor=white"/></a>
  <a href="https://modelcontextprotocol.io"><img alt="MCP" src="https://img.shields.io/badge/MCP-authoring-orange.svg"/></a>
  <a href="https://nodejs.org"><img alt="Node" src="https://img.shields.io/badge/Node-%3E%3D20.19-339933.svg?logo=nodejs&logoColor=white"/></a>
  <a href="https://github.com/PremierStudio/BrowserEngine/graphs/contributors"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg"/></a>
</p>

<p align="center">
  <a href="#what">What it is</a> · <a href="#start">Start</a> · <a href="#flows">Flows</a> ·
  <a href="docs/usage.md">Usage</a> ·
  <a href="docs/ci.md">CI</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="docs/engineering.md">Engineering</a>
</p>

---

<a id="what"></a>

## What it is

You can already ask an agent to click through a checkout. That works **once**. The next morning you want the same path on every commit, without paying for another model call, and without a test that dies the first time a designer changes a CSS id.

Today that usually means one of two dead ends:

- **Chat browsers (most MCP tools).** The agent looks at the page, clicks, and talks to you. Tomorrow you run the agent again. Every replay spends tokens. The path lives in a transcript, not in CI.
- **Recorders (Playwright codegen, Selenium IDE, and friends).** You get `#txt_visit_date` and `.btn-primary`. The next rename breaks the test. The log does not say "Login is gone." It says a selector missed. A person has to debug CSS.

BrowserEngine is the middle path.

The agent drives a real Chrome window and refers to controls the way a person would: "Username", "Login", "the Add to cart near Sauce Labs Backpack." Those **visible names** are what get saved, as ordinary JSON. CI then opens Chrome and follows the same names. No language model is in that run. No MCP session is required. The bill is the same as any other headless test.

When a step fails, CI gets a named report, not a dead CSS selector: `step 2 click Login: two matches`. `--report` writes JSON. `--junit` writes one testcase. This repo does not open tickets or push a heal. Everyone uses a different tracker and a different branch policy. Your next job (or an agent) reads the file and uses _your_ tools.

That is what this repo is for: author with an agent, keep a file, replay without one, emit a report when it breaks. Headed while you watch, headless in CI. Same engine.

### Modes

| Mode                 | For                             | How                                                |
| -------------------- | ------------------------------- | -------------------------------------------------- |
| **Headed** (default) | Authoring and demos             | Visible Chrome, cursor HUD, paced typing           |
| **Headless**         | CI and background               | `BROWSER_ENGINE_HEADED=0`                          |
| **Attach**           | Drive an already-running Chrome | `BROWSER_ENGINE_CDP_URL=http://127.0.0.1:9222`     |
| **Extension**        | Drive your own Brave profile    | `BROWSER_ENGINE_BACKEND=extension` (see below)     |
| **MCP stdio**        | A live agent in this process    | `npm start`                                        |
| **MCP HTTP**         | A remote agent                  | `npm start -- --http`                              |
| **CLI compile**      | Check a flow file, no Chrome    | `node dist/cli.js compile path.json`               |
| **CLI run**          | Replay a flow                   | `node dist/cli.js run path.json`                   |
| **CI report**        | Machine file for any host       | `--json` · `--report out.json` · `--junit out.xml` |

Pace, type delay, expect timeout, and the work-area snap are all env-configurable. See [usage](docs/usage.md).

**Extension** mode skips the second browser entirely: an unpacked MV3 extension drives your signed-in Brave profile over a native-messaging bridge, with a side-panel cockpit, origin allow-list, and a kill switch. Build it with `npm run build:extension`, then follow [`extension/README.md`](extension/README.md).

---

<a id="start"></a>

## Start

Requires Node.js `>= 20.19`.

```bash
git clone https://github.com/PremierStudio/BrowserEngine.git
cd BrowserEngine
npm install
npm run build
```

Check the checked-in fixture (`compile` does not open Chrome). The JSON is a schema example. `https://example.com/login` is not a real form, so do not `run` this file against the network.

```bash
node dist/cli.js compile tests/fixtures/login.flow.json
```

Replay **your** flow headless, and write a report:

```powershell
$env:BROWSER_ENGINE_HEADED='0'
node dist/cli.js run flows/your.flow.json --report reports/flow.json --junit reports/flow.xml
```

A failure names the step (`step 2 click: no target ...`) and the same facts land in the report file. Paste-ready GitHub, GitLab, Forgejo, and Bitbucket jobs: [CI](docs/ci.md).

Give an agent the same engine over MCP:

```bash
npm start
```

Point the client at `node dist/cli.js`. Prefer one `run_flow` over observe-per-page. Full tool list, desk controls, and env vars: [usage](docs/usage.md).

---

<a id="flows"></a>

## Flows

Click and navigate must declare `expectUrl` or `expectText`. Type, hover, scroll, select, and press do not.

```json
{
  "version": 1,
  "name": "login",
  "origin": "https://example.com",
  "steps": [
    {
      "action": "navigate",
      "url": "https://example.com/login",
      "expectText": "Username"
    },
    { "action": "type", "name": "Username", "text": "tomsmith" },
    {
      "action": "click",
      "name": "Login",
      "role": "button",
      "expectText": "Logout"
    }
  ]
}
```

Author with `run_flow` until every bind is unique, write the JSON (no uids), then `compile` / `run` in CI. Any host can fail the job on exit code `1`. Pass `--report` / `--junit` for a machine file your next job (or an agent) can read. Paste-ready GitHub, GitLab, Forgejo, and Bitbucket jobs: [CI](docs/ci.md).

---

## Docs

| Doc                                    | What is in it                                            |
| -------------------------------------- | -------------------------------------------------------- |
| [Usage](docs/usage.md)                 | MCP, desk/page/intent tools, env, public-site demos      |
| [Install](docs/install.md)             | npm package and MCP client setup                         |
| [Extension](docs/extension-cockpit.md) | Brave side-panel cockpit, native host, origin allow-list |
| [CI](docs/ci.md)                       | `compile` / `run` on GitHub, GitLab, Forgejo, Bitbucket  |
| [Architecture](docs/architecture.md)   | Engine, clients, page model, what is not in this repo    |
| [Engineering](docs/engineering.md)     | `npm run ci`, 100/100 gates, stack                       |
| [decisions.md](docs/decisions.md)      | Settled engineering decisions                            |

---

## Contributing

[`AGENTS.md`](AGENTS.md) and [`docs/engineering.md`](docs/engineering.md). Failing test first. No merge below 100% coverage and 100% mutation. TypeScript only.

## License

Apache License 2.0 © [Premier Studio](https://github.com/PremierStudio). See [LICENSE](LICENSE).
