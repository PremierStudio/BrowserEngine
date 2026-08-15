# Install as an MCP server

`@premierstudio/browser-agent` is published to the Premier Studio npm registry on
Forgejo by CI. Push a `v*` tag whose version matches `package.json` and the
[package](https://git.taild1bbf.ts.net/PremierStudio/BrowserAgent/packages) and
[release](https://git.taild1bbf.ts.net/PremierStudio/BrowserAgent/releases)
appear on Forgejo automatically.

## One-time setup

Create a Forgejo access token with `read:package` scope
(Settings → Applications → Generate New Token), then point npm at the registry:

```bash
npm config set @premierstudio:registry https://git.taild1bbf.ts.net/api/packages/PremierStudio/npm/
npm config set //git.taild1bbf.ts.net/api/packages/PremierStudio/npm/:_authToken "$FORGEJO_TOKEN"
```

## Install

```bash
npm install -g @premierstudio/browser-agent
browser-agent --help
```

## MCP client configuration

stdio (default):

```json
{
  "mcpServers": {
    "browser-agent": {
      "command": "browser-agent"
    }
  }
}
```

Streamable HTTP (remote agent):

```json
{
  "mcpServers": {
    "browser-agent": {
      "command": "browser-agent",
      "args": ["--", "--http"],
      "env": {
        "PORT": "3333"
      }
    }
  }
}
```

Modes, flow files, and environment variables: [usage](usage.md).
