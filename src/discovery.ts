import dgram from 'dgram';
import os from 'os';
import type { Peer } from './config';

const MCAST_ADDR = '239.23.23.23';
const MCAST_PORT = 53230;
const HELLO_MS   = 1500;
const STALE_MS   = 5000;

function ipv4Addrs(): string[] {
  const out: string[] = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if ((i as any).family === 'IPv4') out.push((i as any).address as string);
    }
  }
  return out;
}

export function pickLocalIPv4(): string {
  // prefer non-internal
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if ((i as any).family === 'IPv4' && !i.internal) return i.address as string;
    }
  }
  // fallback
  return '127.0.0.1';
}

type PeerEntry = { host: string; port: number; last: number };

export class Discovery {
  private sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  private peers = new Map<string, PeerEntry>();
  private timer: NodeJS.Timeout | null = null;
  private joined: string[] = [];

  constructor(private selfHost: string, private selfPort: number) {}

  start() {
    this.sock.on('error', (e) => {
      console.warn('[disco] socket error', e.message);
    });

    this.sock.on('message', (msg, rinfo) => {
      try {
        const o = JSON.parse(msg.toString('utf8'));
        if (o.t !== 'hello') return;
        const id = `${o.h}:${o.p}`;
        if (id === `${this.selfHost}:${this.selfPort}`) return;
        this.peers.set(id, { host: String(o.h), port: Number(o.p), last: Date.now() });
      } catch {}
    });

    this.sock.on('listening', () => {
      const addr = this.sock.address();
      try {
        this.sock.setMulticastTTL(1);
        this.sock.setMulticastLoopback(true);
      } catch {}
      for (const ifip of ipv4Addrs()) {
        try {
          this.sock.addMembership(MCAST_ADDR, ifip);
          this.joined.push(ifip);
        } catch (e:any) {
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
    if (this.timer) clearInterval(this.timer);
    try { this.sock.close(); } catch {}
  }

  private hello() {
    const msg = Buffer.from(JSON.stringify({ t: 'hello', h: this.selfHost, p: this.selfPort, ts: Date.now() }));
    try {
      this.sock.send(msg, 0, msg.length, MCAST_PORT, MCAST_ADDR);
    } catch (e:any) {
      console.warn('[disco] send failed', e?.message);
    }
    // prune
    const now = Date.now();
    for (const [id, e] of Array.from(this.peers.entries())) {
      if (now - e.last > STALE_MS) this.peers.delete(id);
    }
  }

  getPeers(): Peer[] {
    return Array.from(this.peers.values()).map((e) => [e.host, e.port] as Peer);
  }

  getPeerIds(): string[] {
    return Array.from(this.peers.keys());
  }
}
