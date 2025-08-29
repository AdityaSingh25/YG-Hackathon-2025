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
const commander_1 = require("commander");
const config_1 = require("./config");
const node_1 = require("./node");
const storage_1 = require("./storage");
const client_1 = require("./client");
const dashboard_1 = require("./dashboard");
const fs = __importStar(require("fs/promises"));
const qrcode = __importStar(require("qrcode-terminal"));
const program = new commander_1.Command();
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
    const seeds = String(opts.peers || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(config_1.parsePeer);
    const storage = new storage_1.Storage(opts.storage);
    const adv = opts['advertiseHost'] || undefined;
    const node = new node_1.Node(opts.port, storage, seeds, opts.rf, adv);
    node.serve();
    if (opts['httpPort']) {
        (0, dashboard_1.serveDashboard)(node, opts['httpPort']);
    }
});
program.command('store')
    .argument('<peer>', 'host:port')
    .argument('<path>', 'file to upload')
    .action(async (peerStr, path) => {
    const peer = (0, config_1.parsePeer)(peerStr);
    const data = await fs.readFile(path);
    const h = await (0, client_1.storeBytes)(peer, data, { name: path.split(/[\\\/]/).pop() });
    console.log(h);
    console.log((0, client_1.makeShareLink)(h, path.split(/[\\\/]/).pop() || path));
});
program.command('store-enc')
    .argument('<peer>', 'host:port')
    .argument('<path>', 'file to upload')
    .action(async (peerStr, path) => {
    const peer = (0, config_1.parsePeer)(peerStr);
    const link = await (0, client_1.storeFileEncrypted)(peer, path, path.split(/[\\\/]/).pop());
    console.log(link);
});
program.command('fetch')
    .argument('<hash>')
    .option('--peer <peer>', 'host:port', '127.0.0.1:9001')
    .option('--peers <list>', 'comma-separated peers', '')
    .option('--out <path>', 'output path', 'out.bin')
    .action(async (hash, opts) => {
    const peers = (opts.peers ? String(opts.peers) : String(opts.peer))
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(config_1.parsePeer);
    const raw = await (0, client_1.fetchBytes)(peers, hash);
    await fs.writeFile(opts.out, raw);
    console.log(`wrote ${opts.out} (${raw.length} bytes)`);
});
program.command('link-fetch')
    .argument('<link>')
    .option('--peer <peer>', 'host:port', '127.0.0.1:9001')
    .option('--peers <list>', 'comma-separated peers', '')
    .option('--out <path>', 'output path', 'out.bin')
    .action(async (link, opts) => {
    const peers = (opts.peers ? String(opts.peers) : String(opts.peer))
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(config_1.parsePeer);
    await (0, client_1.fetchFileLink)(peers, link, opts.out);
    console.log(`wrote ${opts.out}`);
});
program.command('share')
    .argument('<peer>', 'host:port')
    .argument('<path>', 'file')
    .option('--no-encrypt', 'disable encryption')
    .option('--compress', 'deflate before encrypt/store')
    .option('--qr', 'print QR in terminal')
    .action(async (peerStr, path, opts) => {
    const peer = (0, config_1.parsePeer)(peerStr);
    const { link } = await (await Promise.resolve().then(() => __importStar(require('./client')))).shareFile(peer, path, opts.encrypt !== false, !!opts.compress);
    console.log(link);
    try {
        const { default: clipboard } = await Promise.resolve().then(() => __importStar(require('clipboardy')));
        await clipboard.write(link);
        console.log('(copied to clipboard)');
    }
    catch { }
    if (opts.qr) {
        try {
            qrcode.generate(link, { small: true });
        }
        catch { }
    }
});
program.parseAsync();
