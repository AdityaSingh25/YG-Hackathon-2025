import { Peer, parsePeer } from './config';
import { sha256Bytes, b64u, de64u } from './hashutil';
import { encryptAESGCM, decryptAESGCM } from './crypto';
import { rpc, Msg } from './protocol';
import * as fs from 'fs/promises';
import * as zlib from 'zlib';

export async function ping(peer: Peer): Promise<boolean> {
  const r = await rpc(peer[0], peer[1], { type: 'ping' });
  return !!r && r.type === 'pong';
}

export async function have(peer: Peer, h: string): Promise<boolean> {
  const r = await rpc(peer[0], peer[1], { type: 'have', hash: h });
  return !!r && r.type === 'have' && !!(r as any).have;
}

export async function discover(peers: Peer[], h: string, timeoutMs = 2000): Promise<Peer | null> {
  const probes = peers.map(async (p) => {
    try {
      const ok = await Promise.race([have(p, h), new Promise<boolean>(res => setTimeout(() => res(false), timeoutMs))]);
      return ok ? p : null;
    } catch { return null; }
  });
  for (const pr of probes) {
    const maybe = await pr;
    if (maybe) return maybe;
  }
  return null;
}

export async function storeBytes(peer: Peer, data: Buffer, meta: any = {}): Promise<string> {
  const h = sha256Bytes(data);
  const r = await rpc(peer[0], peer[1], { type: 'store', hash: h, data: data.toString('base64'), meta });
  if (!r || r.type !== 'ok') throw new Error('store failed');
  return h;
}

export async function fetchBytes(peers: Peer[], h: string): Promise<Buffer> {
  const p = await discover(peers, h);
  if (!p) throw new Error('no providers');
  const r = await rpc(p[0], p[1], { type: 'fetch', hash: h }, 10000);
  if (!r) throw new Error('fetch timeout');
  if (r.type !== 'found') throw new Error('not found');
  return Buffer.from((r as any).data, 'base64');
}

export function makeShareLink(h: string, name: string, key?: Buffer, iv?: Buffer): string {
  if (key && iv) return `dfs://${h}#k=${b64u(key)}&iv=${b64u(iv)}&name=${encodeURIComponent(name)}`;
  return `dfs://${h}#name=${encodeURIComponent(name)}`;
}

export function parseShareLink(link: string): { cid: string, key?: Buffer, iv?: Buffer, name?: string } {
  if (!link.startsWith('dfs://')) throw new Error('bad scheme');
  const rest = link.slice('dfs://'.length);
  const [cid, frag = ''] = rest.split('#', 2);
  const params = new URLSearchParams(frag);
  const k = params.get('k');
  const iv = params.get('iv');
  const name = params.get('name') || undefined;
  return { cid, key: k ? de64u(k) : undefined, iv: iv ? de64u(iv) : undefined, name };
}

export async function storeFileEncrypted(peer: Peer, path: string, filename?: string): Promise<string> {
  const pt = await fs.readFile(path);
  const { ct, key, iv } = encryptAESGCM(pt);
  const h = await storeBytes(peer, ct, { enc: 'aesgcm', name: filename || path });
  return makeShareLink(h, filename || path, key, iv);
}

export async function fetchFileLink(peers: Peer[], link: string, outPath: string): Promise<void> {
  const { cid, key, iv } = parseShareLink(link);
  let raw = await fetchBytes(peers, cid);
  if (key && iv) raw = decryptAESGCM(raw, key, iv);
  await fs.writeFile(outPath, raw);
}

export async function shareFile(peer: Peer, path: string, encrypt = true, compress = false): Promise<{ link: string, bytes: number }> {
  const name = path.split(/[\\\/]/).pop() || path;
  let data = await fs.readFile(path);
  const meta: any = { name };
  if (compress) { data = zlib.deflateSync(data, { level: 6 }); meta.zip = 'deflate'; }
  if (encrypt) {
    const { ct, key, iv } = encryptAESGCM(data);
    const h = await storeBytes(peer, ct, { ...meta, enc: 'aesgcm' });
    return { link: makeShareLink(h, name, key, iv), bytes: ct.length };
  } else {
    const h = await storeBytes(peer, data, meta);
    return { link: makeShareLink(h, name), bytes: data.length };
  }
}
