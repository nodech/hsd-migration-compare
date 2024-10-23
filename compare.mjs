import assert from 'assert';
import { WalletClient } from 'hs-client';
import WalletClientNew from 'hsd/lib/client/wallet.js';

const regtestPortsOld = {
  rpcPort: 14037,
  walletPort: 14039
};

const regtestPortsMigrated = {
  rpcPort: 14038,
  walletPort: 14040
};

const DEFAULT = 'default';
const ALT = 'alt';

// init clients.
const owclient = new WalletClient({
  port: regtestPortsOld.walletPort
});

const nwclient = new WalletClientNew({
  port: regtestPortsMigrated.walletPort
});

/** @type {String[]} */
const wallets = [];

/** @type {[string, string?][]} */
const walletsAndAccounts = [];

// Helper functions.
const getHistoryNew = getPaginatedAll.bind(null, nwclient, nwclient.getHistory);
const getPendingNew = getPaginatedAll.bind(null, nwclient, nwclient.getPending);

// Check that wallets are the same
{
  const walletsOld = await owclient.getWallets();
  const walletsNew = await nwclient.getWallets();
  assert.deepStrictEqual(walletsOld, walletsNew);

  walletsAndAccounts.push(...walletsNew.map(wid => [wid, null]));
  wallets.push(...walletsNew);
}

// Check that accounts are the same
{
  for (const wallet of wallets) {
    const accountsOld = await owclient.getAccounts(wallet);
    const accountsNew = await nwclient.getAccounts(wallet);
    assert.deepStrictEqual(accountsOld, accountsNew);

    walletsAndAccounts.push(...accountsNew.map(accid => [wallet, accid]));
  }
}

// Check if pendings are the same.
{
  for (const [wallet, account] of walletsAndAccounts) {
    await comparePending(wallet, account);
  }
}

// Check history is the same.
{
  for (const [wallet, account] of walletsAndAccounts) {
    await compareHistory(wallet, account);
  }
}

// Check last N.
{
  for (const [wallet, account] of walletsAndAccounts) {
    await compareLast(wallet, account, 10);
    await compareLast(wallet, account, 1000);
  }
}

// Check time queries are the same.
async function comparePending(wallet, account = null) {
  const pendingsOld = await owclient.getPending(wallet, account);
  const pendingsNew = await getPendingNew(wallet, { account });

  assert.strictEqual(pendingsOld.length, pendingsNew.length);
  assert.deepStrictEqual(pendingsOld, pendingsNew);
}

async function compareHistory(wallet, account = null) {
  const historyOld = await owclient.getHistory(wallet, account);
  const historyNew = await getHistoryNew(wallet, { account });
  const pendingNew = await getPendingNew(wallet, { account });

  const hashesOld = historyOld.map(tx => tx.hash);
  const hashesNew = historyNew.map(tx => tx.hash);

  hashesOld.sort();
  hashesNew.sort();

  for (const tx of pendingNew) {
    assert(hashesNew.includes(tx.hash));
    assert(hashesOld.includes(tx.hash));
  }

  assert.strictEqual(hashesOld.length, hashesNew.length);
  assert.deepStrictEqual(hashesOld, hashesNew);
}

async function compareLast(wallet, account = null, n = 100) {
  const lastOld = await owclient.getLast(wallet, account, n);
  // This does not translate directly, but we can use history to get the last 100.
  const lastNew = await getHistoryNew(wallet, {
    account,
    reverse: true
  });

  const lastNewSlice = lastNew.slice(0, n);
  const hashesOld = lastOld.map(tx => tx.hash);
  const hashesNew = lastNewSlice.map(tx => tx.hash);

  hashesOld.sort();
  hashesNew.sort();

  assert.strictEqual(lastOld.length, lastNewSlice.length);
  assert.deepStrictEqual(hashesOld, hashesNew);
}

/**
 * @param {WalletClientNew} client
 * @param {Function} method
 * @param {String} wallet
 * @param {Object} opts
 * @returns {Promise<Object[]>}
 */
async function getPaginatedAll(client, method, wallet, opts) {
  const list = [];
  let last = null;

  for (;;) {
    const next = await method.call(client, wallet, {
      ...opts,
      limit: 10,
      after: last
    });

    if (!next || next.length === 0)
      return list;

    list.push(...next);
    last = next[next.length - 1].hash;
  }
}

function now() {
  return Date.now() / 1000 | 0;
}
