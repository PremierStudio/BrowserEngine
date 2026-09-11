# CI

BrowserEngine does not talk to GitHub, GitLab, Bitbucket, or Forgejo. It does not open tickets and it does not push branches. Those choices belong to your host and your team.

What it does: `compile` then `run`, exit `0` or `1`, and an optional machine report any job can archive. An agent in a later job can read that report and decide what to do.

```bash
npm run build
BROWSER_ENGINE_HEADED=0 node dist/cli.js compile tests/fixtures/login.flow.json --report reports/flow.json --junit reports/flow.xml
BROWSER_ENGINE_HEADED=0 node dist/cli.js run path/to/your.flow.json --report reports/flow.json --junit reports/flow.xml
```

`--json` prints the same report on stdout (one object). `--report` writes it to a file. `--junit` writes one testcase so hosts that already ingest JUnit can show the failure.

A failed run looks like:

```json
{
  "ok": false,
  "command": "run",
  "path": "tests/fixtures/login.flow.json",
  "name": "login",
  "error": "step 2 click: no target for click name=Login candidates=",
  "failure": {
    "step": 2,
    "action": "click",
    "message": "no target for click name=Login candidates="
  }
}
```

Do not auto-commit a healed file onto the branch under test. Leave the job red. If you want a patch, write it as an artifact and let your own tooling open a PR.

## GitHub Actions

```yaml
name: flows
on:
  pull_request:
  push:
    branches: [main, master]
jobs:
  replay:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci && npm run build
      - name: Replay flows
        env:
          BROWSER_ENGINE_HEADED: '0'
        run: |
          mkdir -p reports
          node dist/cli.js compile tests/fixtures/login.flow.json --report reports/flow.json --junit reports/flow.xml
          # run your own flow (the fixture is schema-only, not a live site):
          # node dist/cli.js run flows/your.flow.json --report reports/flow.json --junit reports/flow.xml
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: flow-report
          path: reports/
```

## GitLab CI

```yaml
replay:
  image: node:20
  script:
    - npm ci && npm run build
    - mkdir -p reports
    - BROWSER_ENGINE_HEADED=0 node dist/cli.js compile tests/fixtures/login.flow.json --report reports/flow.json --junit reports/flow.xml
    # run your own flow (the fixture is schema-only, not a live site)
    # - BROWSER_ENGINE_HEADED=0 node dist/cli.js run flows/your.flow.json --report reports/flow.json --junit reports/flow.xml
  artifacts:
    when: always
    reports:
      junit: reports/flow.xml
    paths:
      - reports/
```

## Forgejo Actions

Same as GitHub Actions. Point `uses:` at the Forgejo-hosted `actions/checkout`, `actions/setup-node`, and `actions/upload-artifact` mirrors your instance already provides.

## Bitbucket Pipelines

```yaml
pipelines:
  default:
    - step:
        name: Replay flows
        image: node:20
        script:
          - npm ci && npm run build
          - mkdir -p reports
          - export BROWSER_ENGINE_HEADED=0
          - node dist/cli.js compile tests/fixtures/login.flow.json --report reports/flow.json --junit reports/flow.xml
          # run your own flow (the fixture is schema-only, not a live site)
          # - node dist/cli.js run flows/your.flow.json --report reports/flow.json --junit reports/flow.xml
        artifacts:
          - reports/**
```

## What this is not

- A ticket bot. Everyone uses a different tracker.
- A healer that knows your branching rules.
- A hosted CI product. This is a CLI you drop into a job you already own.
