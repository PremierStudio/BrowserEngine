# Install as an MCP server

`@premierstudio/browser-engine` is published to
[npm](https://www.npmjs.com/package/@premierstudio/browser-engine) by CI. Push a
`v*` tag whose version matches `package.json` and the package is published and a
[release](https://github.com/PremierStudio/BrowserEngine/releases) is created
automatically.

## Install

```bash
npm install -g @premierstudio/browser-engine
browser-engine --help
```

## MCP client configuration

stdio (default):

```json
{
  "mcpServers": {
    "browser-engine": {
      "command": "browser-engine"
    }
  }
}
```

Streamable HTTP (remote agent):

```json
{
  "mcpServers": {
    "browser-engine": {
      "command": "browser-engine",
      "args": ["--", "--http"],
      "env": {
        "PORT": "3333"
      }
    }
  }
}
```

Modes, flow files, and environment variables: [usage](usage.md).
