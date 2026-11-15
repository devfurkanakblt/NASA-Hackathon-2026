/**
 * Base URL of the deployed app, for data and asset requests.
 *
 * The build uses relative paths (`base: './'`) so one dist/ works on Vercel, a GitHub Pages
 * sub-path and an offline folder. On a page, `./data/...` resolves against the page and is
 * right. Inside a Web Worker it resolves against the worker's own script, which the build puts in
 * `assets/`, so `./data/Site01/extended.json` became `/assets/data/Site01/extended.json` (HTTP
 * 404 on Vercel; the dev server serves workers from `/src/...` where the request still found the
 * files). In a worker this returns the folder that holds `assets/` instead.
 */
export function appBase(): string {
  const base = import.meta.env.BASE_URL
  if (/^(\/|[a-z]+:)/i.test(base) || typeof document !== 'undefined') return base
  const href = (globalThis as { location?: Location }).location?.href
  if (!href) return base
  const i = href.indexOf('/assets/')
  return i >= 0 ? href.slice(0, i + 1) : new URL('/', href).href
}
