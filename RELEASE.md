# Release Steps

This project uses a Windows GitHub Actions build to verify and package release artifacts.

## Local release checklist

1. Update the release version in:
   - `version.json`
2. Run `npm run sync:version` so `package.json`, `package-lock.json`, `src/index.html`, `README.md`, and `RELEASE.md` are synchronized from `version.json`.
3. Run local checks:
   ```powershell
   npm run lint
   npm run build:prod
   npm run electron:build
   ```
4. Confirm `release/` contains the expected Windows files:
   - `League Profile Tool Setup <version>.exe`
   - `LeagueProfileTool.zip`
   - `LeagueProfileTool.32-bit.zip`
   - `latest.yml`
   - matching `.blockmap` files
5. Commit the release changes.
6. Push to `main` or `master` and confirm the `Windows Build` workflow passes.
7. Create and push the release tag, for example:
   ```powershell
   git tag V3.3.0
   git push origin V3.3.0
   ```
8. Download the `league-profile-tool-windows` workflow artifact from GitHub Actions.
9. Create a GitHub Release using the same tag and upload the packaged files.
10. Verify the Home tab update check shows the release version once GitHub serves the new release/package data.

## CI behavior

The workflow runs on Windows and performs:

```powershell
npm ci
npm run lint
npm run build:prod
npm run electron:build
```

It uploads packaged files from `release/` as a workflow artifact. The unpacked application folders are intentionally not uploaded.

The CI job uses Node.js 16.20.2 because this app is still on Angular 11 and Electron 12. No dependency upgrades are required for the release workflow.
