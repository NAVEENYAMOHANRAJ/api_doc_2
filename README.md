# Smart API Documentation Generator

Technology-independent API documentation generator for PS08.

This prototype accepts:

- A local codebase path
- A Git repository URL
- A browser folder upload

It scans route/controller/source files, extracts endpoints, request fields, response codes, auth hints, existing OpenAPI specs where present, and exports:

- OpenAPI-like JSON
- OpenAPI YAML
- Markdown documentation
- Static Redoc HTML
- Drift report JSON

## Run

```powershell
node src/server.js
```

Open `http://localhost:4173`.

## CLI

```powershell
node src/cli.js scan .\samples\express-api --output .\generated-docs
```

## Sample

Use `samples/express-api` in the UI local-path scanner to see a working Express project extraction.
