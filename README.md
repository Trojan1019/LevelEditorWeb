# Joker Level Editor Web

Web editor for `level_*.json`, built with Vite + React + TypeScript.

## Local run

```bash
npm install
npm run dev
```

Open: `http://127.0.0.1:5174/`

## Production build

```bash
npm run build
```

Output directory: `dist/`

## Upload to a Git repository and run on web

This project is configured with relative asset paths (`base: "./"` in `vite.config.ts`), so built files can run under:

- root domain, or
- repository sub-paths (for example GitHub Pages `<user>.github.io/<repo>/`)

Recommended deployment flow:

1. Commit the `Tools/LevelEditorWeb` project to your Git repo.
2. Run `npm run build`.
3. Deploy `dist/` to static hosting (GitHub Pages, Netlify, Vercel static, Nginx static root, etc).

### GitHub Pages (quick option)

- Deploy `dist/` contents to `gh-pages` branch root, or
- Deploy with GitHub Actions to Pages artifact.

After deployment, opening the page URL should load directly in browser.

## Extract this tool as a standalone repo

`Tools/LevelEditorWeb` is now self-contained. To extract it:

1. Copy the entire `Tools/LevelEditorWeb` directory to a new repository root.
2. Keep these folders/files together:
   - `src/`
   - `public/` (includes copied sprite assets)
   - `package.json`
   - `package-lock.json`
   - `vite.config.ts`
3. Run:

```bash
npm ci
npm run build
```

No Unity project path is required at runtime.

## Important runtime note

Directory write (`showDirectoryPicker`) only works in supported browsers (Chrome/Edge) and requires user permission.  
If unavailable, use the built-in import/export JSON flow.
