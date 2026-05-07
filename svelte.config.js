import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  compilerOptions: process.env.VITEST
    ? {
        // Allow `new Component({ target })` in unit tests (jsdom + Node runner).
        compatibility: { componentApi: 4 }
      }
    : {},
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      // Avoid overwriting the prerendered index.html with the SPA fallback.
      fallback: '200.html',
      precompress: true,
      strict: true
    }),
    prerender: {
      handleHttpError: 'warn'
    }
  }
};

export default config;
