import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import crypto from 'node:crypto';
import cjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import swc from '@swc/core';
import { rollup } from 'rollup';
import esbuild from 'rollup-plugin-esbuild';
import tsConfigPaths from 'rollup-plugin-tsconfig-paths';

const extensions = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.cts', '.mts'];
const plugins = process.argv.slice(2).filter(x => !x.startsWith('-'));
const dev = process.argv.includes('--dev') || process.argv.includes('-d');

const ImportMap: Record<string, string> = {
    react: 'React',
    'react-native': 'ReactNative',
};

if (!existsSync('./dist')) await mkdir('./dist');

const pluginDirs = plugins.length ? plugins : await readdir('./plugins');

for (const plugin of pluginDirs) {
    console.log(`\n📦 Building ${plugin}...`);
    const manifestPath = `./plugins/${plugin}/manifest.json`;
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));

    try {
        const bundle = await rollup({
            input: `./plugins/${plugin}/${manifest.main}`,
            watch: {
                include: `./plugins/${plugin}/**`,
            },
            onwarn(warning) {
                if (warning.code === 'MISSING_NAME_OPTION_FOR_IIFE_EXPORT') return;
                return console.warn(warning.message);
            },
            external: id => Boolean(id.match(/^@(revenge-mod|vendetta)/)) || !!ImportMap[id],
            plugins: [
                tsConfigPaths(),
                nodeResolve(),
                cjs(),
                {
                    name: 'swc',
                    async transform(code, id) {
                        const ext = extname(id);
                        if (!extensions.includes(ext)) return null;

                        const ts = ext.includes('ts');
                        const tsx = ts ? ext.endsWith('x') : undefined;
                        const jsx = !ts ? ext.endsWith('x') : undefined;

                        const result = await swc.transform(code, {
                            filename: id,
                            jsc: {
                                externalHelpers: false,
                                parser: {
                                    syntax: ts ? 'typescript' : 'ecmascript',
                                    tsx,
                                    jsx,
                                },
                            },
                            env: {
                                targets: 'fully supports es6',
                                include: [
                                    'transform-block-scoping',
                                    'transform-classes',
                                    'transform-async-to-generator',
                                    'transform-async-generator-functions',
                                ],
                            },
                        });
                        return result.code;
                    },
                },
                esbuild({
                    minifySyntax: !dev,
                    minifyWhitespace: !dev,
                    define: {
                        IS_DEV: String(dev),
                    },
                }),
            ],
        });

        const code = await bundle
            .write({
                file: `./dist/${plugin}/index.js`,
                globals(id) {
                    if (ImportMap[id]) return ImportMap[id];

                    const replaceSlashWithDot = (s: string) => s.replaceAll('/', '.');

                    if (id.startsWith('@vendetta')) return replaceSlashWithDot(id.substring(1));
                    if (id.startsWith('@revenge-mod')) return `bunny${replaceSlashWithDot(id.substring(12))}`;

                    throw new Error(`Unable to resolve import path for: ${id}`);
                },
                format: 'iife',
                compact: true,
                exports: 'named',
            })
            .then(result => result.output[0].code);

        await bundle.close();

        manifest.main = 'index.js';
        manifest.hash = crypto.createHash('sha256').update(code).digest('hex');
        await writeFile(`./dist/${plugin}/manifest.json`, JSON.stringify(manifest, null, 4), 'utf-8');

        console.log(`✅ Successfully built: ${manifest.name}`);
    } catch (e) {
        console.error(`❌ Failed to build plugin ${manifest.name}:`, e);
        process.exit(1);
    }
}
