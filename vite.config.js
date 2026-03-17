import { sveltekit } from '@sveltejs/kit/vite';
import UnoCSS from 'unocss/vite';
import { defineConfig } from 'vite';
import presetUno from '@unocss/preset-uno';
import presetWebFonts from '@unocss/preset-web-fonts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function forceBrowserConditionsForVitest() {
  return {
    name: 'force-browser-conditions-for-vitest',
    config(config, env) {
      const isVitest = env.mode === 'test' || process.env.VITEST;
      if (!isVitest) return;

      config.ssr ??= {};
      config.ssr.target = 'webworker';
      config.ssr.resolve ??= {};

      const current = config.ssr.resolve.conditions ?? config.resolve?.conditions ?? [];
      config.ssr.resolve.conditions = Array.from(new Set(['browser', ...current]));

      const external = config.ssr.resolve.externalConditions ?? ['node', 'module-sync'];
      config.ssr.resolve.externalConditions = Array.from(new Set(['browser', ...external]));

      // Make sure Testing Library goes through Vite transform so its `svelte` import
      // sees the same conditions as the test files.
      const currentNoExternal = config.ssr.noExternal;
      const add = ['@testing-library/svelte', '@testing-library/svelte-core'];
      if (currentNoExternal === true) return;
      if (!currentNoExternal) {
        config.ssr.noExternal = add;
      } else if (Array.isArray(currentNoExternal)) {
        config.ssr.noExternal = Array.from(new Set([...currentNoExternal, ...add]));
      } else {
        // string | RegExp
        config.ssr.noExternal = [currentNoExternal, ...add];
      }
    }
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isVitest = Boolean(process.env.VITEST);
const svelteClientEntry = path.resolve(__dirname, 'node_modules/svelte/src/index-client.js');
const svelteStoreClientEntry = path.resolve(__dirname, 'node_modules/svelte/src/store/index-client.js');

export default defineConfig(({ mode }) => {
  const isTest = mode === 'test' || isVitest;

  return {
    resolve: {
      // Vitest runs modules through Vite SSR in Node. We want the client runtime in jsdom tests.
      alias: isTest
        ? [
            { find: /^svelte$/, replacement: svelteClientEntry },
            { find: /^svelte\/store$/, replacement: svelteStoreClientEntry }
          ]
        : []
    },

    plugins: [
      UnoCSS({
        presets: [
          presetUno(),
          presetWebFonts({
            provider: 'none',
            fonts: { sans: 'Inter', mono: 'JetBrains Mono' }
          })
        ]
      }),
      sveltekit(),
      forceBrowserConditionsForVitest()
    ],

    define: {
      __DEV__: mode === 'development',
      __PROD__: mode === 'production',
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version)
    },

    build: {
      sourcemap: mode === 'development',
      target: 'es2020',
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Object-form manualChunks breaks SSR builds when a dependency is externalized.
            // Function-form only chunks modules that are actually bundled.
            if (id.includes('/node_modules/peerjs/')) return 'peerjs';
            if (id.includes('/node_modules/dexie/')) return 'dexie';
          }
        }
      }
    },

    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/tests/setup.js']
    }
  };
});
