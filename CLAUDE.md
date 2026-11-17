# Media Workbench development rules

## Scope and architecture

- This repository is a DeepSeek Harness plugin. `src/host.js` owns server routes; `client/` contains the React UI bundled by esbuild.
- Keep content in the existing `items` / `mergedDrafts` / `production` model. Route persistent changes through `Store`; preserve Markdown projection and undo behavior.
- Preserve the existing data layout: `灵感/`, `内容/<id>/内容.md`, and `attachments/`. Do not introduce a second content store.
- Keep browser-shared helpers free of Node.js APIs. Reuse existing UI components and translations.
- Keep credentials out of source, fixtures, logs, and screenshots.

## Current implementation scope

- Complete the article and image-text generation, editing, and export flow.
- Articles use complete prose with inline figures. Image-text uses short copy and an ordered image set.
- Expose title editing, full-content copying, export, and existing scheduling / publishing actions for both formats.
- Distinguish finished generation from complete deliverables: surface fallback text, missing images, and per-image failures. Retry one image without regenerating the text or other images.
- Use one placement policy for article preview, Markdown projection, and exported content. Keep image-text image order consistent.
- Preserve existing video behavior; new card templates, platform automation, and analytics are outside this phase.

## Validation

- Run targeted Node tests first, then `npm test` and `npm run build`.
- Test both ordinary and merged drafts, full and partial results, and export asset integrity.
- Use temporary data and the development sandbox for browser validation. Do not exercise real publishing or paid models without appropriate authorization.
- Report mocked validation separately from real-provider validation.
- Do not commit or push unless requested.
