"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ping = ping;
exports.have = have;
exports.discover = discover;
exports.storeBytes = storeBytes;
exports.fetchBytes = fetchBytes;
exports.makeShareLink = makeShareLink;
exports.parseShareLink = parseShareLink;
exports.storeFileEncrypted = storeFileEncrypted;
exports.fetchFileLink = fetchFileLink;
exports.shareFile = shareFile;
const hashutil_1 = require("./hashutil");
const crypto_1 = require("./crypto");
const protocol_1 = require("./protocol");
const fs = __importStar(require("fs/promises"));
const zlib = __importStar(require("zlib"));
async function ping(peer) {
    const r = await (0, protocol_1.rpc)(peer[0], peer[1], { type: 'ping' });
    return !!r && r.type === 'pong';
}
async function have(peer, h) {
    const r = await (0, protocol_1.rpc)(peer[0], peer[1], { type: 'have', hash: h });
    return !!r && r.type === 'have' && !!r.have;
}
async function discover(peers, h, timeoutMs = 2000) {
    const probes = peers.map(async (p) => {
        try {
            const ok = await Promise.race([have(p, h), new Promise(res => setTimeout(() => res(false), timeoutMs))]);
            return ok ? p : null;
        }
        catch {
            return null;
        }
    });
    for (const pr of probes) {
        const maybe = await pr;
        if (maybe)
            return maybe;
    }
    return null;
}
async function storeBytes(peer, data, meta = {}) {
    const h = (0, hashutil_1.sha256Bytes)(data);
    const r = await (0, protocol_1.rpc)(peer[0], peer[1], { type: 'store', hash: h, data: data.toString('base64'), meta });
    if (!r || r.type !== 'ok')
        throw new Error('store failed');
    return h;
}
async function fetchBytes(peers, h) {
    const p = await discover(peers, h);
    if (!p)
        throw new Error('no providers');
    const r = await (0, protocol_1.rpc)(p[0], p[1], { type: 'fetch', hash: h }, 10000);
    if (!r)
        throw new Error('fetch timeout');
    if (r.type !== 'found')
        throw new Error('not found');
    return Buffer.from(r.data, 'base64');
}
function makeShareLink(h, name, key, iv) {
    if (key && iv)
        return `dfs://${h}#k=${(0, hashutil_1.b64u)(key)}&iv=${(0, hashutil_1.b64u)(iv)}&name=${encodeURIComponent(name)}`;
    return `dfs://${h}#name=${encodeURIComponent(name)}`;
}
function parseShareLink(link) {
    if (!link.startsWith('dfs://'))
        throw new Error('bad scheme');
    const rest = link.slice('dfs://'.length);
    const [cid, frag = ''] = rest.split('#', 2);
    const params = new URLSearchParams(frag);
    const k = params.get('k');
    const iv = params.get('iv');
    const name = params.get('name') || undefined;
    return { cid, key: k ? (0, hashutil_1.de64u)(k) : undefined, iv: iv ? (0, hashutil_1.de64u)(iv) : undefined, name };
}
async function storeFileEncrypted(peer, path, filename) {
    const pt = await fs.readFile(path);
    const { ct, key, iv } = (0, crypto_1.encryptAESGCM)(pt);
    const h = await storeBytes(peer, ct, { enc: 'aesgcm', name: filename || path });
    return makeShareLink(h, filename || path, key, iv);
}
async function fetchFileLink(peers, link, outPath) {
    const { cid, key, iv } = parseShareLink(link);
    let raw = await fetchBytes(peers, cid);
    if (key && iv)
        raw = (0, crypto_1.decryptAESGCM)(raw, key, iv);
    await fs.writeFile(outPath, raw);
}
async function shareFile(peer, path, encrypt = true, compress = false) {
    const name = path.split(/[\\\/]/).pop() || path;
    let data = await fs.readFile(path);
    const meta = { name };
    if (compress) {
        data = zlib.deflateSync(data, { level: 6 });
        meta.zip = 'deflate';
    }
    if (encrypt) {
        const { ct, key, iv } = (0, crypto_1.encryptAESGCM)(data);
        const h = await storeBytes(peer, ct, { ...meta, enc: 'aesgcm' });
        return { link: makeShareLink(h, name, key, iv), bytes: ct.length };
    }
    else {
        const h = await storeBytes(peer, data, meta);
        return { link: makeShareLink(h, name), bytes: data.length };
    }
}
