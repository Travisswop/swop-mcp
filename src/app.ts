// Express app shared by the local server (src/http.ts) and the Vercel
// function (api/index.ts). Stateless Streamable HTTP: one server+transport
// pair per request so any replica/invocation can serve any call.
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from './server.js';
import { mountStore } from './store.js';
import { mountShare } from './share.js';

export function buildApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, name: 'swop-mcp' });
  });

  // OAuth discovery: tells MCP clients which authorization server guards the
  // authed tools (the swop-app-backend /oauth surface).
  app.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.json({
      resource: process.env.PUBLIC_BASE_URL ?? 'https://mcp.swopme.co',
      authorization_servers: [process.env.SWOP_API_BASE ?? 'https://apps.apiswop.co'],
      bearer_methods_supported: ['header'],
    });
  });

  app.post('/mcp', async (req, res) => {
    const server = buildServer(req.header('authorization') ?? undefined);
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
  });

  const methodNotAllowed = (_req: express.Request, res: express.Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed' },
      id: null,
    });
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  mountStore(app);
  mountShare(app);

  // Root: human-readable pointer for anyone who opens the URL in a browser.
  app.get('/', (_req, res) => {
    res.json({
      name: 'Swop MCP server',
      endpoint: '/mcp',
      transport: 'streamable-http',
      docs: 'https://swopme.co',
    });
  });

  return app;
}
