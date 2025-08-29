"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Discovery = void 0;
exports.pickLocalIPv4 = pickLocalIPv4;
const dgram_1 = __importDefault(require("dgram"));
const os_1 = __importDefault(require("os"));
const MCAST_ADDR = '239.23.23.23';
const MCAST_PORT = 53230;
const HELLO_MS = 1500;
const STALE_MS = 5000;
function ipv4Addrs() {
    const out = [];
    const ifs = os_1.default.networkInterfaces();
    for (const name of Object.keys(ifs)) {
        for (const i of ifs[name] || []) {
            if (i.family === 'IPv4')
                out.push(i.address);
        }
    }
    return out;
}
function pickLocalIPv4() {
    // prefer non-internal
    const ifs = os_1.default.networkInterfaces();
    for (const name of Object.keys(ifs)) {
        for (const i of ifs[name] || []) {
            if (i.family === 'IPv4' && !i.internal)
                return i.address;
        }
    }
    // fallback
    return '127.0.0.1';
}
class Discovery {
    constructor(selfHost, selfPort) {
        this.selfHost = selfHost;
        this.selfPort = selfPort;
        this.sock = dgram_1.default.createSocket({ type: 'udp4', reuseAddr: true });
        this.peers = new Map();
        this.timer = null;
        this.joined = [];
    }
    start() {
        this.sock.on('error', (e) => {
            console.warn('[disco] socket error', e.message);
        });
        this.sock.on('message', (msg, rinfo) => {
            try {
                const o = JSON.parse(msg.toString('utf8'));
                if (o.t !== 'hello')
                    return;
                const id = `${o.h}:${o.p}`;
                if (id === `${this.selfHost}:${this.selfPort}`)
                    return;
                this.peers.set(id, { host: String(o.h), port: Number(o.p), last: Date.now() });
            }
            catch { }
        });
        this.sock.on('listening', () => {
            const addr = this.sock.address();
            try {
                this.sock.setMulticastTTL(1);
                this.sock.setMulticastLoopback(true);
            }
            catch { }
            for (const ifip of ipv4Addrs()) {
                try {
                    this.sock.addMembership(MCAST_ADDR, ifip);
                    this.joined.push(ifip);
                }
                catch (e) {
                    //   console.warn('[disco] addMembership failed', ifip, e?.message);
                }
            }
            this.timer = setInterval(() => this.hello(), HELLO_MS);
            this.hello();
            console.log(`[disco] listening on ${JSON.stringify(addr)}; joined on [${this.joined.join(', ')}]`);
        });
        this.sock.bind(MCAST_PORT, '0.0.0.0');
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        try {
            this.sock.close();
        }
        catch { }
    }
    hello() {
        const msg = Buffer.from(JSON.stringify({ t: 'hello', h: this.selfHost, p: this.selfPort, ts: Date.now() }));
        try {
            this.sock.send(msg, 0, msg.length, MCAST_PORT, MCAST_ADDR);
        }
        catch (e) {
            console.warn('[disco] send failed', e?.message);
        }
        // prune
        const now = Date.now();
        for (const [id, e] of Array.from(this.peers.entries())) {
            if (now - e.last > STALE_MS)
                this.peers.delete(id);
        }
    }
    getPeers() {
        return Array.from(this.peers.values()).map((e) => [e.host, e.port]);
    }
    getPeerIds() {
        return Array.from(this.peers.keys());
    }
}
exports.Discovery = Discovery;
