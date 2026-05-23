# Klipy API Setup Guide

## What is Klipy?
Klipy is a GIF and sticker API provider. AetherChat uses it to power the in-app GIF/sticker picker.

## Step 1 — Create a Klipy account
1. Go to `https://klipy.com/`
2. Create an account (sign up / log in)

## Step 2 — Create an API key
Klipy keys are managed in the Partner Panel.

1. Open the Partner Panel (`partner.klipy.com`)
2. Navigate to **API Keys**
3. Click **Add Platform** / create a new key

## Step 3 — Configure for local development
1. In the project root, create a file named `.env`
2. Add:

```bash
PUBLIC_KLIPY_API_KEY=your_api_key_here
```

3. Restart the dev server after changing `.env`

## Step 4 — Configure for Cloudflare Pages (production)
1. Open your Cloudflare Pages project
2. Go to **Settings → Environment Variables**
3. Add a new variable:
   Name: `PUBLIC_KLIPY_API_KEY`
   Value: your API key
4. Set it for both **Production** and **Preview**
5. Redeploy

## Step 5 — Verify the integration
Run the app locally and open the GIF picker in any chat.

If trending GIFs load, the integration is working.

## CI/CD Configuration — GitHub Actions
The CI build imports the Klipy env var at runtime (via `$env/dynamic/public`), but the build step should still have the variable present.

1. In GitHub, go to repository **Settings → Secrets and variables → Actions**
2. Add a new repository secret:
   Name: `PUBLIC_KLIPY_API_KEY`
   Value: any placeholder value (CI does not need a real production key)
3. Ensure `.github/workflows/ci.yml` passes it to the build step:

```yaml
- name: Build
  run: npm run build
  env:
    PUBLIC_KLIPY_API_KEY: ${{ secrets.PUBLIC_KLIPY_API_KEY }}
```

## Free tier limits
Klipy’s migration page describes a **Test Key** rate limit (e.g. 100 API calls per hour) and Production access as unlimited.

AetherChat minimizes API calls via local caching:
- Trending results are cached for 10 minutes
- Search results are cached for 5 minutes

## Troubleshooting
- “Klipy API key not found”: verify `PUBLIC_KLIPY_API_KEY` is set and the app was restarted
- “Rate limit exceeded”: wait for the limit window to reset; caching should reduce requests
- Images not loading: check browser console for network/CORS errors and confirm Klipy endpoints are reachable
