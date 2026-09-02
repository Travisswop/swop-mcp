// Shareable product links — one URL that works for both humans and AI agents.
//   GET /p/:handle/:sku
//     • Agent (Accept: application/json, or ?agent=1) → 302 to the x402 buy URL
//       (the machine-payable endpoint that returns the 402 challenge).
//     • Human (browser) → a clean product page: image, name, price, seller, and
//       a "Buy on Swop" button into the seller's SmartSite.
// This lives on the MCP server (not the x402 controller), so it composes with
// the existing storefront without touching the commerce backend.
import type express from 'express';
import { SWOP_API_BASE } from './config.js';
import { getJson } from './http-client.js';

type StoreProduct = {
  sku: string;
  name: string;
  description?: string;
  image?: string | null;
  priceUsd: number;
  currency?: string;
  shippingRequired?: boolean;
  buyUrl: string;
};

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function wantsAgent(req: express.Request): boolean {
  if (req.query.agent === '1') return true;
  const accept = req.header('accept') || '';
  // A browser sends text/html first; agents/fetch default to */* or JSON.
  if (accept.includes('text/html')) return false;
  return accept.includes('application/json') || accept === '*/*' || accept === '';
}

export function mountShare(app: express.Express): void {
  app.get('/p/:handle/:sku', async (req, res) => {
    const handle = req.params.handle.toLowerCase();
    const sku = req.params.sku;
    let store: { handle: string; name?: string; products: StoreProduct[] };
    try {
      const r = (await getJson(SWOP_API_BASE, `/api/v5/x402/store/${handle}`)) as {
        data: { handle: string; name?: string; products: StoreProduct[] };
      };
      store = r.data;
    } catch {
      res.status(404).type('html').send(page('Not found', '<p>That store or product could not be found.</p>'));
      return;
    }
    const product = store.products.find((p) => p.sku === sku);
    if (!product) {
      res.status(404).type('html').send(page('Not found', '<p>That product could not be found.</p>'));
      return;
    }

    // Agents get the machine-payable endpoint.
    if (wantsAgent(req)) {
      res.redirect(302, product.buyUrl);
      return;
    }

    // Humans get a product page. "Buy on Swop" opens the seller's SmartSite.
    const sellerUrl = `https://swopme.app/sp/${encodeURIComponent(handle)}`;
    const price = `$${product.priceUsd.toFixed(2)} ${product.currency || 'USDC'}`;
    const body = `
<div class="card">
  ${product.image ? `<img src="${esc(product.image)}" alt="${esc(product.name)}" class="img">` : ''}
  <div class="pad">
    <div class="seller">${esc(store.name || store.handle)} &middot; <span class="handle">${esc(store.handle)}</span></div>
    <h1>${esc(product.name)}</h1>
    <div class="price">${esc(price)}${product.shippingRequired ? ' <span class="ship">+ shipping</span>' : ''}</div>
    ${product.description ? `<p class="desc">${esc(product.description)}</p>` : ''}
    <a class="btn" href="${esc(sellerUrl)}">Buy on Swop</a>
    <div class="agent">This product is also payable by AI agents in USDC (x402).</div>
  </div>
</div>`;
    res.type('html').send(page(`${product.name} — ${store.handle}`, body, product.image || undefined));
  });
}

function page(title: string, inner: string, ogImage?: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<style>
  :root{color-scheme:light dark}
  body{font-family:-apple-system,system-ui,sans-serif;background:#f6f5fb;color:#16181d;margin:0;display:grid;place-items:center;min-height:100vh;padding:1.2rem}
  @media (prefers-color-scheme:dark){body{background:#131318;color:#e9e8f0}.card{background:#1b1b24!important}.desc{color:#a3a5b3!important}}
  .card{background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(20,18,40,.10);max-width:22rem;overflow:hidden}
  .img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
  .pad{padding:1.3rem}
  .seller{font-size:.8rem;color:#8a8fa0;margin-bottom:.3rem}
  .handle{color:#5b3df5}
  h1{font-size:1.3rem;margin:.1rem 0 .5rem}
  .price{font-size:1.15rem;font-weight:700}
  .ship{font-size:.8rem;font-weight:500;color:#8a8fa0}
  .desc{color:#555b68;font-size:.92rem;margin:.7rem 0}
  .btn{display:block;text-align:center;margin-top:1rem;background:#5b3df5;color:#fff;text-decoration:none;padding:.75rem;border-radius:11px;font-weight:600}
  .agent{margin-top:.9rem;font-size:.74rem;color:#8a8fa0;text-align:center}
</style></head><body>${inner}</body></html>`;
}
