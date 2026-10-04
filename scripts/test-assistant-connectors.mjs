import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer, AUTHED_TOOL_NAMES } from '../dist/server.js';
async function connect(auth, profile='full') {
 const server=buildServer(auth,{profile});const client=new Client({name:'connector-test',version:'1.0.0'});
 const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(a),client.connect(b)]);return {server,client};
}
const {server,client}=await connect();
const listed=await client.listTools();
for (const name of ['swop_get_token_price','swop_get_sports','swop_get_help']) {
 assert(listed.tools.some(t=>t.name===name));assert(AUTHED_TOOL_NAMES.has(name));
}
const unauth=await client.callTool({name:'swop_get_token_price',arguments:{token:'SOL'}});assert.equal(unauth.isError,true);
await client.close();await server.close();
const linked=await connect('Bearer synthetic-test-token');let captured;
const original=globalThis.fetch;globalThis.fetch=async (url,opts)=>{captured={url,opts};return {ok:true,json:async()=>({data:{message:'Verified price'}})};};
try {
 const price=await linked.client.callTool({name:'swop_get_token_price',arguments:{token:'SWOP',address:'ExactCaseMint',chain:'solana'}});
 assert(!price.isError);assert(captured.url.endsWith('/api/v5/mcp/assistant/read'));
 assert.equal(JSON.parse(captured.opts.body).params.address,'ExactCaseMint');assert.equal(captured.opts.headers.authorization,'Bearer synthetic-test-token');
 const invalid=await linked.client.callTool({name:'swop_get_sports',arguments:{query:'game',topic:'execute'}});assert.equal(invalid.isError,true);
} finally {globalThis.fetch=original;await linked.client.close();await linked.server.close();}
const commerce=await connect(undefined,'commerce');const tools=await commerce.client.listTools();assert(!tools.tools.some(t=>t.name==='swop_get_sports'));await commerce.client.close();await commerce.server.close();
console.log('PASS: connector discovery, auth requirement, exact identity, schema rejection, commerce scope');
