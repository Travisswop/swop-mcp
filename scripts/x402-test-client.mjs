// Acts as a buyer AI agent: fetches an x402 buy URL, reads the 402 challenge,
// signs a USDC EIP-3009 transferWithAuthorization for the exact amount, and
// retries with the X-PAYMENT header. Base Sepolia by default.
//
// Usage:
//   node scripts/x402-test-client.mjs <buyUrl> [privateKey]
// Without a key, an ephemeral wallet is generated (payment will fail at
// verification with an insufficient-balance style error — which still proves
// the full 402 → sign → facilitator pipeline). Fund the printed address with
// Base Sepolia USDC (faucet.circle.com) and re-run with the key to settle.

import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const [, , buyUrl, pkArg] = process.argv;
if (!buyUrl) {
  console.error('usage: node scripts/x402-test-client.mjs <buyUrl> [privateKey]');
  process.exit(1);
}

const pk = pkArg ?? generatePrivateKey();
const account = privateKeyToAccount(pk);
console.log('agent wallet:', account.address);
if (!pkArg) console.log('ephemeral key:', pk);

// Simulated user profile the agent "knows" — sent as X-ORDER when the
// product requires shipping (server responds 400 listing required fields).
const SHIPPING = {
  name: 'Travis Test Buyer',
  email: 'travis@swopme.co',
  line1: '123 Agent Way',
  city: 'Charlotte',
  state: 'NC',
  postalCode: '28202',
  country: 'US',
};
const orderHeader = Buffer.from(JSON.stringify(SHIPPING)).toString('base64');

let challengeRes = await fetch(buyUrl, { headers: { accept: 'application/json' } });
if (challengeRes.status === 400) {
  const info = await challengeRes.json();
  console.log('   server requires order fields:', (info.requiredOrderFields || []).join(', '));
  console.log('   resending with shipping info (X-ORDER)');
  challengeRes = await fetch(buyUrl, {
    headers: { accept: 'application/json', 'X-ORDER': orderHeader },
  });
}
console.log('\n1) challenge status:', challengeRes.status);
const challenge = await challengeRes.json();
if (challengeRes.status !== 402) {
  console.log(JSON.stringify(challenge, null, 2));
  process.exit(challengeRes.status === 200 ? 0 : 1);
}
const req = challenge.accepts?.[0];
console.log('   requires:', req.maxAmountRequired, 'USDC-units →', req.payTo, 'on', req.network);

const chainId = req.network === 'base' ? 8453 : 84532;
const now = Math.floor(Date.now() / 1000);
const nonce = `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
const authorization = {
  from: account.address,
  to: req.payTo,
  value: BigInt(req.maxAmountRequired),
  validAfter: BigInt(now - 60),
  validBefore: BigInt(now + (req.maxTimeoutSeconds ?? 300)),
  nonce,
};

const signature = await account.signTypedData({
  domain: {
    name: req.extra?.name ?? 'USDC',
    version: req.extra?.version ?? '2',
    chainId,
    verifyingContract: req.asset,
  },
  types: {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  },
  primaryType: 'TransferWithAuthorization',
  message: authorization,
});
console.log('2) signed transferWithAuthorization');

const paymentPayload = {
  x402Version: 1,
  scheme: 'exact',
  network: req.network,
  payload: {
    signature,
    authorization: {
      ...authorization,
      value: authorization.value.toString(),
      validAfter: authorization.validAfter.toString(),
      validBefore: authorization.validBefore.toString(),
    },
  },
};
const header = Buffer.from(JSON.stringify(paymentPayload)).toString('base64');

const payRes = await fetch(buyUrl, {
  headers: { accept: 'application/json', 'X-PAYMENT': header, 'X-ORDER': orderHeader },
});
console.log('3) payment attempt status:', payRes.status);
const result = await payRes.json();
console.log(JSON.stringify(result, null, 2));
const proof = payRes.headers.get('x-payment-response');
if (proof) console.log('settlement proof:', Buffer.from(proof, 'base64').toString());
