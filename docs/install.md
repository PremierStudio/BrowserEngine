# Install as an MCP server

`@premierstudio/browser-agent` is published to
[npm](https://www.npmjs.com/package/@premierstudio/browser-agent) by CI. Push a
`v*` tag whose version matches `package.json` and the package is published and a
[release](https://github.com/PremierStudio/BrowserEngine/releases) is created
automatically.

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
