Noto Sans SC variable WOFF2 subsets are self-hosted here for backend PDFs.
Source: the pinned `@fontsource-variable/noto-sans-sc` package, originally Google
Noto Sans SC. License: `OFL-NotoSansSC.txt` (SIL Open Font License 1.1).

`noto-sans-sc.css` retains the subset Unicode ranges. All referenced fonts in
`files/` are required for complete Simplified Chinese coverage. The PDF service
embeds them as data URLs and performs no third-party font requests.

Regenerate explicitly with `npm run fonts:copy`; include this directory in
the backend deployment alongside `dist/`.
