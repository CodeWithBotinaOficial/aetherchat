import { sveltekit } from '@sveltejs/kit/vite';
import UnoCSS from 'unocss/vite';
import { defineConfig } from 'vite';
import presetUno from '@unocss/preset-uno';
import presetWebFonts from '@unocss/preset-web-fonts';

export default defineConfig({
  plugins: [
    UnoCSS({
      presets: [
        presetUno(),
        presetWebFonts({
          fonts: {
            sans: 'Inter',
            mono: 'JetBrains Mono'
          }
        })
      ]
    }),
    sveltekit()
  ]
});
