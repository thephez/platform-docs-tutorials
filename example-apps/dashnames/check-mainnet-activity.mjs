/**
 * Verifies dashnames Activity rows against mainnet directly.
 *
 * Answers, in order:
 *   1. What protocol version is mainnet actually running? (v13 gates history)
 *   2. Does the Document History contract exist there at all?
 *   3. What raw history records exist for the name, per stream?
 *   4. What does the DPNS `domain` document itself say right now?
 *
 * Every numeric field is read through the per-field getters / `properties`,
 * never `toJSON()` — a u64 price above MAX_SAFE_INTEGER throws and takes the
 * whole document with it (dashpay/platform#3786).
 *
 * Usage:
 *   node check-mainnet-activity.mjs [name] [--network mainnet|testnet]
 *   node check-mainnet-activity.mjs splawik21
 *   node check-mainnet-activity.mjs splawik21 --network testnet
 */
import { createClient } from '../../setupDashClient-core.mjs';

const DPNS_CONTRACT_ID = 'GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec';
const HISTORY_CONTRACT_ID = '6voHRaoiPcfmMhbqCA9dixH98xcgPQ9UEcuaXjpVu3LD';
const STREAMS = ['priceUpdate', 'purchase', 'transfer'];
const CREDITS_PER_DASH = 100_000_000_000n;

const argv = process.argv.slice(2);
const networkFlag = argv.indexOf('--network');
const network = networkFlag !== -1 ? argv[networkFlag + 1] : 'mainnet';
const inputLabel = (argv.find((a) => !a.startsWith('--') && a !== network) ?? 'splawik21')
  .replace(/\.dash$/i, '')
  .trim()
  .toLowerCase();

// ---------------------------------------------------------------- base58

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function bytesToBase58(bytes) {
  if (bytes.length === 0) return '';
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits = [];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      const value = digits[j] * 256 + carry;
      digits[j] = value % 58;
      carry = (value / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) out += BASE58[digits[i]];
  return out;
}

// ------------------------------------------------------- lossless readers

function readId(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return bytesToBase58(value);
  if (Array.isArray(value)) return bytesToBase58(Uint8Array.from(value));
  if (typeof value === 'object') {
    const s = String(value);
    return s && s !== '[object Object]' ? s : null;
  }
  return null;
}

function readBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function props(doc) {
  return doc?.properties ?? {};
}

function docId(doc) {
  return readId(doc?.id) ?? readId(props(doc).$id);
}

/**
 * Mirrors lib/safeDoc.ts `toDocumentArray`. The SDK returns a Map (or a plain
 * object keyed by document id) — NOT `{documents: [...]}`. Getting this wrong
 * yields a silent empty result for every query.
 */
function toArray(results) {
  if (results == null) return [];
  if (Array.isArray(results)) return results;
  if (results instanceof Map) return [...results.values()].filter(Boolean);
  if (typeof results === 'object') return Object.values(results).filter(Boolean);
  return [];
}

function formatCredits(credits) {
  if (credits == null) return '—';
  const dash = Number(credits) / Number(CREDITS_PER_DASH);
  return `${credits.toString()} credits (${dash.toLocaleString('en-US', {
    maximumFractionDigits: 8,
  })} DASH)`;
}

function stamp(ms) {
  if (ms == null) return 'unknown';
  return new Date(Number(ms)).toISOString();
}

// -------------------------------------------------------------- main

const sdk = await createClient(network);

// DPNS folds visually-confusable characters (l/i -> 1, o -> 0), so `latte` is
// stored as `1atte`. Querying the raw lowercase label matches NOTHING. Use the
// SDK's own fold rather than reimplementing it — a local copy would drift from
// consensus.
const label = await sdk.dpns.convertToHomographSafe(inputLabel);

console.log(`\n=== dashnames activity check — ${network} — "${inputLabel}.dash" ===\n`);
if (label !== inputLabel) {
  console.log(`[0] Homograph fold: "${inputLabel}" -> normalizedLabel "${label}"\n`);
}

// 1. Protocol version --------------------------------------------------
let activeVersion = null;
try {
  const status = await sdk.system.status();
  const json = typeof status?.toJSON === 'function' ? status.toJSON() : status;
  const drive = json?.version?.protocol?.drive ?? {};
  activeVersion = drive.current ?? null;
  console.log('[1] Protocol version');
  console.log(`    version.protocol.drive.current : ${drive.current}   <- the gate`);
  console.log(`    version.protocol.drive.latest  : ${drive.latest}`);
  console.log(`    software.drive                 : ${json?.version?.software?.drive}`);
  console.log(`    block height                   : ${json?.chain?.latestBlockHeight}`);
  console.log(
    `    => history contract expected to exist: ${(drive.current ?? 0) >= 13 ? 'YES' : 'NO (pre-v13)'}\n`,
  );
} catch (e) {
  console.log(`[1] Protocol version — FAILED: ${e.message}\n`);
}

// 2. Does the History contract exist here? ------------------------------
console.log('[2] Document History contract');
let historyExists = false;
try {
  const contract = await sdk.contracts.fetch(HISTORY_CONTRACT_ID);
  historyExists = contract != null;
  console.log(`    ${HISTORY_CONTRACT_ID}`);
  console.log(`    => FOUND on ${network}\n`);
} catch (e) {
  console.log(`    ${HISTORY_CONTRACT_ID}`);
  console.log(`    => NOT FOUND: ${e.message}`);
  console.log(`    (this is what isMissingContractError swallows into [])\n`);
}

// 3. The DPNS domain document ------------------------------------------
console.log('[3] DPNS domain document');
let domainDocId = null;
let domainOwner = null;
try {
  const domains = toArray(
    await sdk.documents.query({
      dataContractId: DPNS_CONTRACT_ID,
      documentTypeName: 'domain',
      where: [
        ['normalizedParentDomainName', '==', 'dash'],
        ['normalizedLabel', '==', label],
      ],
      // Required: the index matcher reserves the order-by field from the back
      // of `parentNameAndLabel`. Without it the query matches nothing silently.
      orderBy: [['normalizedLabel', 'asc']],
      limit: 1,
    }),
  );
  if (domains.length === 0) {
    console.log(`    => no "${label}.dash" registered on ${network}`);
    // Independent path: resolveName goes through the SDK's own lookup rather
    // than a hand-built indexed query, so it distinguishes "name absent" from
    // "my query was shaped wrong".
    try {
      const resolved = await sdk.dpns.resolveName(`${inputLabel}.dash`);
      console.log(`    !! but sdk.dpns.resolveName says it EXISTS -> ${resolved}`);
      console.log('    => the query above is wrong, not the data\n');
    } catch (e) {
      console.log(`    resolveName agrees it is absent: ${e.message}\n`);
    }
  } else {
    const doc = domains[0];
    const p = props(doc);
    domainDocId = docId(doc);
    domainOwner = readId(doc.ownerId);
    const price = readBigInt(p.$price ?? doc.price);
    console.log(`    documentId : ${domainDocId}`);
    console.log(`    owner      : ${domainOwner}`);
    console.log(`    label      : ${p.label}`);
    console.log(`    records    : ${readId(p.records?.identity) ?? JSON.stringify(p.records)}`);
    console.log(`    revision   : ${doc.revision}`);
    console.log(`    $price     : ${price == null ? 'not set (NOT listed for sale)' : formatCredits(price)}`);
    console.log('');
  }
} catch (e) {
  console.log(`    => query FAILED: ${e.message}\n`);
}

// 4. Raw history records for this document ------------------------------
console.log('[4] History records (raw, per stream)');
if (!historyExists) {
  console.log('    skipped — history contract does not exist on this network');
  console.log('    => ANY activity rows shown in the app for this network are NOT from here\n');
} else if (!domainDocId) {
  console.log('    skipped — no domain document to look up\n');
} else {
  for (const type of STREAMS) {
    try {
      const docs = toArray(
        await sdk.documents.query({
          dataContractId: HISTORY_CONTRACT_ID,
          documentTypeName: type,
          where: [
            ['dataContractId', '==', DPNS_CONTRACT_ID],
            ['documentId', '==', domainDocId],
          ],
          orderBy: [['$createdAt', 'asc']],
          limit: 100,
        }),
      );
      console.log(`    ${type}: ${docs.length} record(s)`);
      for (const doc of docs) {
        const p = props(doc);
        const price = readBigInt(p.price);
        const createdAt = readBigInt(doc.createdAt ?? p.$createdAt);
        console.log(`      - $id        : ${docId(doc)}`);
        console.log(`        createdAt  : ${stamp(createdAt)}`);
        console.log(`        block      : ${doc.createdAtBlockHeight ?? p.$createdAtBlockHeight ?? '—'}`);
        console.log(`        ownerId    : ${readId(doc.ownerId)}`);
        if (p.price !== undefined) console.log(`        price      : ${formatCredits(price)}`);
        if (p.sellerId !== undefined) console.log(`        sellerId   : ${readId(p.sellerId)}`);
        if (p.toIdentityId !== undefined) console.log(`        toIdentity : ${readId(p.toIdentityId)}`);
      }
    } catch (e) {
      console.log(`    ${type}: query FAILED — ${e.message}`);
    }
  }
  console.log('');
}

console.log('=== done ===\n');
