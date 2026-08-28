// stdio entry for local testing: `claude mcp add swop -- npx tsx src/stdio.ts`
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server.js';

const server = buildServer();
await server.connect(new StdioServerTransport());
