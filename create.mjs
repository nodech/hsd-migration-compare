import assert from 'assert';
import { NodeClient, WalletClient } from 'hs-client';

const regtestPorts = {
  rpcPort: 14037,
  walletPort: 14039
};

/**
 * Wallets and accounts:
 *  - primary
 *    - default - coinbase
 *  - wallet1 - 1k txs
 *    - default - 1k txs
 *    - alt - 1k txs
 *  - wallet2 - 1k txs
 *    - default - 1k txs
 *    - alt - 1k txs
 *  1k txs for each, 100 unconfirmed.
 *  delay 100ms between each tx. (for time look ups)
 */

const DEFAULT = 'default';
const ALT = 'alt';

const PRIMARY = 'primary';
const WALLET_1 = 'wallet1';
const WALLET_2 = 'wallet2';

const INITIAL_BLOCKS = 100;

const nclient = new NodeClient({
  port: regtestPorts.rpcPort
});
const wclient = new WalletClient({
  port: regtestPorts.walletPort
});

const coinbase = (await wclient.getAccount(PRIMARY, DEFAULT)).receiveAddress;

await initWallets();
// Give coinbase some coins
await mineTill(INITIAL_BLOCKS, coinbase);

// Fund all
await fundAll();

// Operations
// 100 primary -> wallet1/default
// 100 primary -> wallet1/alt
// 100 wallet1/default -> wallet1/alt
// 100 wallet1/alt -> wallet1/default

// 100 primary -> wallet2/default
// 100 primary -> wallet2/alt
// 100 wallet2/default -> wallet2/alt
// 100 wallet2/alt -> wallet2/default
const total = 100;
const opsPerBlock = 2; // 2 operations of the mapping per block.
const maxHeight = total / 2 + (INITIAL_BLOCKS + 1)
const height = await currentHeight();
const ops = (maxHeight - height) * opsPerBlock;
const mappings = [
  [PRIMARY, DEFAULT, WALLET_1, DEFAULT],
  [PRIMARY, DEFAULT, WALLET_1, ALT],
  [WALLET_1, DEFAULT, WALLET_1, ALT],
  [WALLET_1, ALT, WALLET_1, DEFAULT],
  [PRIMARY, DEFAULT, WALLET_2, DEFAULT],
  [PRIMARY, DEFAULT, WALLET_2, ALT],
  [WALLET_2, DEFAULT, WALLET_2, ALT],
  [WALLET_2, ALT, WALLET_2, DEFAULT]
]

await sendTXs({
  mappings,
  opsCount: ops,
  opsPerBlock,
  opDelay: 100,
  value: 1e6
});

// 1 buffer block
await mineTill(maxHeight + 1, coinbase);

const totalPendingOps = 10;
const pendingTXs = totalPendingOps * 4;

const pending = await wclient.getPending(PRIMARY, DEFAULT);
const pendingOps = (pendingTXs - pending.length) / 4;

if (pendingOps > 0) {
  await sendTXs({
    mappings,
    opsCount: pendingOps,
    opsPerBlock: 10000, // disable
    opDelay: 100,
    value: 1e6
  });
}

async function initWallets() {
  const allWallets = await wclient.getWallets();

  if (!allWallets.includes(WALLET_1)) {
    const wallet = await wclient.createWallet(WALLET_1);
    assert(wallet);
  }

  if (!allWallets.includes(WALLET_2)) {
    const wallet = await wclient.createWallet(WALLET_2);
    assert(wallet);
  }

  const accounts1 = await wclient.getAccounts(WALLET_1);

  if (!accounts1.includes(ALT)) {
    const account = await wclient.createAccount(WALLET_1, ALT);
    assert(account);
  }

  const accounts2 = await wclient.getAccounts(WALLET_2);

  if (!accounts2.includes(ALT)) {
    const account = await wclient.createAccount(WALLET_2, ALT);
    assert(account);
  }
}

async function fundAll() {
  const height = (await nclient.getInfo()).chain.height;
  const balance = await wclient.getBalance(PRIMARY, DEFAULT);

  if (height != INITIAL_BLOCKS && balance.coin !== INITIAL_BLOCKS)
    return;

  const addr11 = (await wclient.getAccount(WALLET_1, DEFAULT)).receiveAddress;
  const addr12 = (await wclient.getAccount(WALLET_1, ALT)).receiveAddress;
  const addr21 = (await wclient.getAccount(WALLET_2, DEFAULT)).receiveAddress;
  const addr22 = (await wclient.getAccount(WALLET_2, ALT)).receiveAddress;

  await wclient.send(PRIMARY, {
    outputs: [
      { value: 10000e6, address: addr11 },
      { value: 10000e6, address: addr12 },
      { value: 10000e6, address: addr21 },
      { value: 10000e6, address: addr22 }
    ]
  });

  await mineTill(INITIAL_BLOCKS + 1, coinbase);
}

async function sendTXs(options) {
  const {
    mappings,
    opsCount,
    opsPerBlock,
    opDelay,
    value
  } = options;

  for (let i = 1; i < opsCount + 1; i++) {
    for (let map of mappings) {
      const [fromWallet, fromAccount, toWallet, toAccount] = map;
      const toAddr = (await wclient.getAccount(toWallet, toAccount)).receiveAddress;

      await wclient.send(fromWallet, {
        account: fromAccount,
        outputs: [
          { value, address: toAddr }
        ]
      });

    }

    if (i % opsPerBlock === 0)
      await mineBlocks(1, coinbase);

    await new Promise(r => setTimeout(r, opDelay));
  }
}

async function currentHeight() {
  return (await nclient.getInfo()).chain.height;
}

async function mineTill(blocks, cb) {
  const current = await currentHeight();
  const toMine = blocks - current;

  if (toMine <= 0)
    return;

  await mineBlocks(toMine, cb);
}

async function mineBlocks(blocks, cb) {
  await nclient.execute('generatetoaddress', [blocks, cb]);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// async function send(wallet, address, value) {
//   await wallet.send(address, {

//   });
// }

// TX list
//   200 w1a1 -> w1a2
//   200 w1a1 -> w2a1
//   200 w1a1 -> w2a2
//
//   200 w1a2 -> w1a1
//   200 w1a2 -> w2a1
//   200 w1a2 -> w2a2
//
//   200 w2a1 -> w1a1
//   200 w2a1 -> w1a2
//   200 w2a1 -> w2a2
//
//   200 w2a2 -> w1a1
//   200 w2a2 -> w1a2
//   200 w2a2 -> w2a1
//
// Total 2400 txs
// Total send and received per wallet/account 1200 txs
