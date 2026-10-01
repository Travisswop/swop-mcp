// Smoke test for the full (/mcp) and commerce-only (/mcp/commerce) endpoints.
//
//   npm run smoke                              # in-process app on a random port
//   npm run smoke -- https://mcp.swopme.co     # against a deployed host
//
// Asserts: tools/list counts, that no money-moving / trading / prediction tool
// leaks into the commerce endpoint, that server instructions are sent, the
// path-based RFC 9728 metadata for each endpoint, and the 401 challenge's
// resource_metadata URL.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { buildApp } from '../src/app.js';
import { COMMERCE_EXCLUDED_TOOL_NAMES } from '../src/server.js';

const rpc = async (url: string, body: unknown) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { res, json: text ? JSON.parse(text) : null };
};

async function main() {
  let base = process.argv[2]?.replace(/\/$/, '');
  let close = () => {};
  if (!base) {
    const listener = buildApp().listen(0);
    await new Promise((r) => listener.once('listening', r));
    base = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
    close = () => listener.close();
  }
  const expectedOrigin = process.argv[2] ? base : process.env.PUBLIC_BASE_URL ?? 'https://mcp.swopme.co';

  try {
    const init = await rpc(`${base}/mcp/commerce`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } },
    });
    assert.equal(init.res.status, 200);
    assert.match(init.json.result.instructions, /sell to people and AI agents/);

    const list = async (path: string) =>
      (await rpc(`${base}${path}`, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json.result.tools.map(
        (t: { name: string }) => t.name,
      ) as string[];

    const full = await list('/mcp');
    const commerce = await list('/mcp/commerce');
    for (const name of COMMERCE_EXCLUDED_TOOL_NAMES) {
      assert.ok(full.includes(name), `${name} missing from /mcp`);
      assert.ok(!commerce.includes(name), `${name} leaked into /mcp/commerce`);
    }
    assert.equal(commerce.length, full.length - COMMERCE_EXCLUDED_TOOL_NAMES.size);
    for (const name of ['swop_create_product', 'swop_get_store', 'swop_create_checkout', 'swop_get_product_link']) {
      assert.ok(commerce.includes(name), `${name} missing from /mcp/commerce`);
    }

    for (const [path, resource] of [
      ['/.well-known/oauth-protected-resource/mcp', '/mcp'],
      ['/.well-known/oauth-protected-resource/mcp/commerce', '/mcp/commerce'],
    ]) {
      const meta = await (await fetch(`${base}${path}`)).json();
      assert.equal(meta.resource, `${expectedOrigin}${resource}`, path);
      if (resource === '/mcp/commerce') {
        assert.deepEqual(meta.scopes_supported, ['profile.read', 'wallet.read', 'smartsite.write', 'commerce.write'], path);
      } else {
        assert.equal(meta.scopes_supported, undefined, `${path} must stay unchanged`);
      }
    }

    const challenge = await rpc(`${base}/mcp/commerce`, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'swop_get_my_orders', arguments: {} },
    });
    assert.equal(challenge.res.status, 401);
    assert.equal(
      challenge.res.headers.get('www-authenticate'),
      `Bearer resource_metadata="${expectedOrigin}/.well-known/oauth-protected-resource/mcp/commerce"`,
    );

    // An excluded authed tool is unknown on the commerce endpoint, not a sign-in prompt.
    const excluded = await rpc(`${base}/mcp/commerce`, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'swop_send', arguments: {} },
    });
    assert.equal(excluded.res.status, 200);
    assert.ok(excluded.json.error || excluded.json.result?.isError, 'swop_send must not run on /mcp/commerce');

    console.log(`ok: /mcp ${full.length} tools, /mcp/commerce ${commerce.length} tools (${base})`);
  } finally {
    close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
