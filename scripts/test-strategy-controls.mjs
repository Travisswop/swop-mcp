import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {buildServer,AUTHED_TOOL_NAMES} from '../dist/server.js';
async function connect(auth,profile='full') {
 const server=buildServer(auth,{profile}),client=new Client({name:'strategy-test',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(a),client.connect(b)]);return {server,client,close:async()=>{await client.close();await server.close();}};
}
const publicSession=await connect();
assert(AUTHED_TOOL_NAMES.has('swop_resolve_strategy_markets'));
assert((await publicSession.client.callTool({name:'swop_resolve_strategy_markets',arguments:{request:'trade gold, ETH and any stock'}})).isError);
await publicSession.close();
const session=await connect('Bearer synthetic-test-token');const original=globalThis.fetch;let captured;
globalThis.fetch=async(url,opts)=>{captured={url,opts};return {ok:true,json:async()=>({data:{previewId:'sealed-preview'}})};};
try {
 const discovery=await session.client.callTool({name:'swop_resolve_strategy_markets',arguments:{request:'trade gold, ETH and any stock'}});
 assert(!discovery.isError);assert(captured.url.endsWith('/api/v5/mcp/agent/markets'));
 const args={action:'revise_strategy',strategyId:'exact-owner-plan',revision:{assets:['ETH','xyz:GOLD','xyz:NVDA'],entryCondition:'Evaluate each market independently'}};
 const preview=await session.client.callTool({name:'swop_update_my_agent',arguments:args});
 assert(!preview.isError);assert(captured.url.endsWith('/api/v5/mcp/agent/changes'));assert.deepEqual(JSON.parse(captured.opts.body),args);
 assert((await session.client.callTool({name:'swop_update_my_agent',arguments:{...args,revision:{limits:{maxOrderUsd:999}}}})).isError);
 assert(! (await session.client.callTool({name:'swop_update_my_agent',arguments:{previewId:'sealed-preview',confirm:true}})).isError);
 assert.deepEqual(JSON.parse(captured.opts.body),{previewId:'sealed-preview',confirm:true});
} finally {globalThis.fetch=original;await session.close();}
const commerce=await connect(undefined,'commerce');const names=(await commerce.client.listTools()).tools.map(t=>t.name);
assert(!names.includes('swop_resolve_strategy_markets'));assert(!names.includes('swop_update_my_agent'));await commerce.close();
console.log('PASS strategy discovery, auth, sealed edit payload, bounded schema and commerce separation');
