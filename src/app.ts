// Express app shared by the local server (src/http.ts) and the Vercel
// function (api/index.ts). Stateless Streamable HTTP: one server+transport
// pair per request so any replica/invocation can serve any call.
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer, AUTHED_TOOL_NAMES, COMMERCE_EXCLUDED_TOOL_NAMES, type ServerProfile } from './server.js';
import { mountStore } from './store.js';
import { mountShare } from './share.js';

export function buildApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  // 4mb (just under Vercel's 4.5 MB function body cap) so swop_create_feed_post
  // can carry an inline base64 image.
  app.use(express.json({ limit: '4mb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, name: 'swop-mcp' });
  });

  // OpenAI Plugins Directory domain verification. Serves ONLY this plugin's
  // challenge token as plain text (the portal rejects JSON/multiple tokens).
  app.get('/.well-known/openai-apps-challenge', (_req, res) => {
    res
      .type('text/plain')
      .send(process.env.OPENAI_APPS_CHALLENGE_TOKEN ?? 'ExCkQW-dMw3B8g8ZWxTB2NHuGmqeRlI7TxGSS1nUcNw');
  });

  // OAuth discovery: tells MCP clients which authorization server guards the
  // authed tools (the swop-app-backend /oauth surface).
  //
  // `resource` must be the canonical resource identifier the client is talking
  // to — the MCP endpoint itself, not the bare origin (RFC 9728 s2). It used to
  // advertise the origin, which does not match the audience the client asks the
  // authorization server for.
  //
  // The document is served at two paths because clients derive the lookup URL
  // from the resource PATH: for https://mcp.swopme.co/mcp the well-known
  // segment is inserted between host and path, giving
  // /.well-known/oauth-protected-resource/mcp (RFC 9728 s3.1). Only the root
  // form existed, so every spec-conformant lookup 404'd and the client
  // concluded the server was unauthenticated.
  //
  // The commerce-only endpoint (/mcp/commerce) is its own protected resource,
  // so it gets its own path-derived document (…/oauth-protected-resource/mcp/commerce)
  // naming itself as `resource`. Same authorization server: the backend issues
  // aud "mcp" tokens and does not bind them to the `resource` parameter, so one
  // token works on both endpoints.
  const publicBase = () => process.env.PUBLIC_BASE_URL ?? 'https://mcp.swopme.co';
  const ENDPOINT_PATHS: Record<ServerProfile, string> = { full: '/mcp', commerce: '/mcp/commerce' };
  const protectedResourceMetadata = (profile: ServerProfile = 'full') => ({
    resource: `${publicBase()}${ENDPOINT_PATHS[profile]}`,
    authorization_servers: [process.env.SWOP_API_BASE ?? 'https://apps.apiswop.co'],
    bearer_methods_supported: ['header'],
  });
  const metadataUrl = (profile: ServerProfile) =>
    `${publicBase()}/.well-known/oauth-protected-resource${ENDPOINT_PATHS[profile]}`;
  const serveProtectedResourceMetadata =
    (profile: ServerProfile) => (_req: express.Request, res: express.Response) => {
      res.json(protectedResourceMetadata(profile));
    };
  app.get('/.well-known/oauth-protected-resource', serveProtectedResourceMetadata('full'));
  app.get('/.well-known/oauth-protected-resource/mcp', serveProtectedResourceMetadata('full'));
  app.get('/.well-known/oauth-protected-resource/mcp/commerce', serveProtectedResourceMetadata('commerce'));

  // Does this JSON-RPC payload invoke a tool that needs a linked Swop account?
  // Batches are answered with a challenge if ANY member needs one — the client
  // re-sends the whole batch after signing in.
  const needsAuth = (body: unknown, profile: ServerProfile): boolean => {
    const calls = Array.isArray(body) ? body : [body];
    return calls.some((call) => {
      if (!call || typeof call !== 'object') return false;
      const { method, params } = call as { method?: unknown; params?: unknown };
      if (method !== 'tools/call') return false;
      const name = (params as { name?: unknown } | undefined)?.name;
      if (typeof name !== 'string' || !AUTHED_TOOL_NAMES.has(name)) return false;
      // A tool the commerce endpoint does not expose is an unknown tool there,
      // not a reason to start sign-in.
      return !(profile === 'commerce' && COMMERCE_EXCLUDED_TOOL_NAMES.has(name));
    });
  };

  const firstId = (body: unknown): unknown => {
    const call = Array.isArray(body) ? body[0] : body;
    return (call as { id?: unknown } | undefined)?.id ?? null;
  };

  const handleMcp = (profile: ServerProfile) => async (req: express.Request, res: express.Response) => {
    // Public tools (discovery, markets, stores) stay open, so `initialize` and
    // `tools/list` are never challenged. Only an unauthenticated call to an
    // account-scoped tool gets the 401 — without this the SDK returns the
    // link-your-account message inside a 200 JSON-RPC result, which every MCP
    // client reads as a successful call that happened to return text, so the
    // sign-in flow is never offered.
    if (!req.header('authorization') && needsAuth(req.body, profile)) {
      res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${metadataUrl(profile)}"`);
      res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Not linked to a Swop account. Sign in with Swop to use this tool.',
        },
        id: firstId(req.body),
      });
      return;
    }

    const server = buildServer(req.header('authorization') ?? undefined, { profile });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('mcp request failed', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  };
  app.post('/mcp', handleMcp('full'));
  app.post('/mcp/commerce', handleMcp('commerce'));

  const methodNotAllowed = (_req: express.Request, res: express.Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed' },
      id: null,
    });
  };
  app.get(['/mcp', '/mcp/commerce'], methodNotAllowed);
  app.delete(['/mcp', '/mcp/commerce'], methodNotAllowed);

  mountStore(app);
  mountShare(app);

  // The human-facing landing page for the site root is served statically from
  // public/index.html — Vercel's filesystem check handles "/" before the
  // catch-all rewrite to /api (the rewrite mishandles the bare root).

  return app;
}
