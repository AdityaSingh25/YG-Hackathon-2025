import { Command } from 'commander';
import { parsePeer, Peer } from './config';
import { Node } from './node';
import { Storage } from './storage';
import { storeBytes, fetchBytes, storeFileEncrypted, fetchFileLink, makeShareLink } from './client';
import { serveDashboard } from './dashboard';
import * as fs from 'fs/promises';
import * as qrcode from 'qrcode-terminal';

const program = new Command();

program
  .name('tiny-p2p-fs-ts')
  .description('Tiny P2P FS (TypeScript)')
  .version('0.1.0');

program.command('server')
  .requiredOption('--port <n>', 'listen port', (v) => Number(v))
  .option('--storage <path>', 'storage dir', 'storage')
  .option('--peers <list>', 'comma-separated host:port (optional seeds)', '')
  .option('--rf <n>', 'replication factor (0 = all peers)', (v) => Number(v), 2)
  .option('--http-port <n>', 'dashboard HTTP port (0 to disable)', (v) => Number(v), 8088)
  .option('--advertise-host <ip>', 'override autodetected LAN IP', '')
  .action(async (opts) => {
    const seeds: Peer[] = String(opts.peers || '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean)
      .map(parsePeer);
    const storage = new Storage(opts.storage);
    const adv = opts['advertiseHost'] || undefined;
    const node = new Node(opts.port, storage, seeds, opts.rf, adv);
    node.serve();
    if (opts['httpPort']) {
      serveDashboard(node, opts['httpPort']);
    }
  });


program.command('store')
  .argument('<peer>', 'host:port')
  .argument('<path>', 'file to upload')
  .action(async (peerStr: string, path: string) => {
    const peer = parsePeer(peerStr);
    const data = await fs.readFile(path);
    const h = await storeBytes(peer, data, { name: path.split(/[\\\/]/).pop() });
    console.log(h);
    console.log(makeShareLink(h, path.split(/[\\\/]/).pop() || path));
  });

program.command('store-enc')
  .argument('<peer>', 'host:port')
  .argument('<path>', 'file to upload')
  .action(async (peerStr: string, path: string) => {
    const peer = parsePeer(peerStr);
    const link = await storeFileEncrypted(peer, path, path.split(/[\\\/]/).pop());
    console.log(link);
  });

program.command('fetch')
  .argument('<hash>')
  .option('--peer <peer>', 'host:port', '127.0.0.1:9001')
  .option('--peers <list>', 'comma-separated peers', '')
  .option('--out <path>', 'output path', 'out.bin')
  .action(async (hash: string, opts) => {
    const peers: Peer[] = (opts.peers ? String(opts.peers) : String(opts.peer))
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean)
      .map(parsePeer);
    const raw = await fetchBytes(peers, hash);
    await fs.writeFile(opts.out, raw);
    console.log(`wrote ${opts.out} (${raw.length} bytes)`);
  });

program.command('link-fetch')
  .argument('<link>')
  .option('--peer <peer>', 'host:port', '127.0.0.1:9001')
  .option('--peers <list>', 'comma-separated peers', '')
  .option('--out <path>', 'output path', 'out.bin')
  .action(async (link: string, opts) => {
    const peers: Peer[] = (opts.peers ? String(opts.peers) : String(opts.peer))
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean)
      .map(parsePeer);
    await fetchFileLink(peers, link, opts.out);
    console.log(`wrote ${opts.out}`);
  });

program.command('share')
  .argument('<peer>', 'host:port')
  .argument('<path>', 'file')
  .option('--no-encrypt', 'disable encryption')
  .option('--compress', 'deflate before encrypt/store')
  .option('--qr', 'print QR in terminal')
  .action(async (peerStr: string, path: string, opts) => {
    const peer = parsePeer(peerStr);
    const { link } = await (await import('./client')).shareFile(
      peer, path, opts.encrypt !== false, !!opts.compress
    );
    console.log(link);
    try { const { default: clipboard } = await import('clipboardy'); await clipboard.write(link); console.log('(copied to clipboard)'); } catch {}
    if (opts.qr) { try { qrcode.generate(link, { small: true }); } catch {} }
  });

program.parseAsync();
