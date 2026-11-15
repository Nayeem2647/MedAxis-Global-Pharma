import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

// Run explicitly when upgrading the pinned Fontsource package. Deployment uses these checked-in assets.
const root = new URL('../../', import.meta.url);
const source = new URL('node_modules/@fontsource-variable/noto-sans-sc/', root);
const target = new URL('public/fonts/', root);
const css = await readFile(new URL('index.css', source), 'utf8');
const paths = [...new Set([...css.matchAll(/url\((\.\/files\/[\w-]+\.woff2)\)/g)].map((match) => match[1]!))];
if (!paths.length) throw new Error('No Noto Sans SC WOFF2 files found');
await mkdir(new URL('files/', target), { recursive: true });
for (const path of paths) await copyFile(new URL(path, source), new URL(path, target));
await copyFile(new URL('LICENSE', source), new URL('OFL-NotoSansSC.txt', target));
await writeFile(new URL('noto-sans-sc.css', target), css);
process.stdout.write(`Copied ${paths.length} self-hosted Noto Sans SC WOFF2 subsets and license.\n`);
