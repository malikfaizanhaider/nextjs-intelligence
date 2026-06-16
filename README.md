# Next.js Intelligence

Next.js Intelligence is a static analysis toolkit for Next.js applications. It discovers routes, components, API route handlers, dependency graphs, diagnostics, orphan components, and route-level ownership/composition metadata.

## CLI

```bash
nextjs-intelligence analyze
nextjs-intelligence graph --json
nextjs-intelligence diagnostics --json
nextjs-intelligence mcp
```

`analyze` remains the default command and preserves the existing analyzer pipeline and output files.

## MCP server

Start the Model Context Protocol server over stdio:

```bash
nextjs-intelligence mcp --root /path/to/your/next-app
```

The MCP server reuses the same analyzer core as the CLI. It does not duplicate route analysis, dependency graph generation, diagnostics, orphan detection, component mapping, or ownership/composition logic.

### Tools

- `analyze_project` — project summary.
- `get_routes` — discovered page routes.
- `analyze_route` — route details, components, hooks, providers, complexity, and dependencies.
- `get_api_routes` — all API route handlers.
- `find_component_usage` — usages and render relationships for a component.
- `get_dependency_graph` — upstream/downstream relationships for a node.
- `find_orphans` — orphan/dead components.
- `impact_analysis` — affected routes, components, APIs, and dependency chain for a file change.

Example tool inputs:

```json
{ "route": "/apo-grading-exceptions" }
```

```json
{ "component": "AppBadge" }
```

```json
{ "file": "src/components/common-components/AppBadge/AppBadge.tsx" }
```

## Cursor integration

Add an MCP server entry that launches the package in your project root:

```json
{
  "mcpServers": {
    "nextjs-intelligence": {
      "command": "nextjs-intelligence",
      "args": ["mcp", "--root", "/path/to/your/next-app"]
    }
  }
}
```

## Claude Desktop integration

Add the server to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nextjs-intelligence": {
      "command": "nextjs-intelligence",
      "args": ["mcp", "--root", "/path/to/your/next-app"]
    }
  }
}
```

## VS Code MCP integration

Add a server definition to your VS Code MCP settings:

```json
{
  "servers": {
    "nextjs-intelligence": {
      "type": "stdio",
      "command": "nextjs-intelligence",
      "args": ["mcp", "--root", "/path/to/your/next-app"]
    }
  }
}
```

## Example prompts

- “Explain route `/apo-grading-exceptions`.”
- “Show all usages of `AppBadge`.”
- “What breaks if I modify `AppBadge.tsx`?”
- “List orphan components.”
- “Show upstream and downstream dependencies for `src/components/AppBadge.tsx`.”

## Migration notes

- The existing analyzer architecture is preserved. CLI commands and MCP tools both call the shared pipeline and manifest services.
- `nextjs-intelligence mcp` starts a stdio MCP server suitable for Cursor, Claude Desktop, VS Code, and MCP Inspector.
- The package now exposes both `intelligence` and `nextjs-intelligence` binaries.
- Runtime target is Node.js 22 LTS or newer, with TypeScript 5.9 metadata for current ecosystem compatibility.
