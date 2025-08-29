import * as net from "net";
import { Peer } from "./config";
import { Storage } from "./storage";
import { Msg, rpc, sendMsg } from "./protocol";
import { Discovery, pickLocalIPv4 } from "./discovery";
import { sha256Bytes } from "./hashutil";

type Event = { ts: number; kind: string; [k: string]: any };

class Metrics {
  started = Date.now() / 1000;
  bytesIn = 0;
  bytesOut = 0;
  recent: Event[] = [];
  event(kind: string, extra: any = {}) {
    this.recent.push({ ts: Date.now() / 1000, kind, ...extra });
    this.recent = this.recent.slice(-200);
  }
  toJSON() {
    return {
      uptime_s: Math.floor(Date.now() / 1000 - this.started),
      bytes_in: this.bytesIn,
      bytes_out: this.bytesOut,
      recent: this.recent.slice(-50),
    };
  }
}

type PeerState = {
  alive: boolean;
  latencyMs: number | null;
  peers: string[];
  last: number;
};

function peerId(p: Peer): string {
  return `${p[0]}:${p[1]}`;
}

export class Node {
  metrics = new Metrics();
  private peerState = new Map<string, PeerState>();
  private selfId: string;
  private discovery: Discovery;
  private seeds: Peer[]; // optional static peers for bootstrapping

  constructor(
    public port: number,
    public storage: Storage,
    seeds: Peer[] = [],
    public rf = 2,
    advertiseHost?: string
  ) {
    const host = advertiseHost || pickLocalIPv4();
    this.selfId = `${host}:${this.port}`;
    this.discovery = new Discovery(host, this.port);
    this.seeds = seeds;
  }

  // === Public helpers for dashboard / HTTP ===
  public getPeersList(): Peer[] {
    return this.dynamicPeers();
  }

  public async storeLocalAndReplicate(buf: Buffer, meta: any = {}): Promise<string> {
    const h = sha256Bytes(buf);
    await this.storage.put(h, buf, meta);
    this.metrics.bytesIn += buf.length;
    this.metrics.event("upload", { hash: h, size: buf.length });
    console.log(`[upload] stored ${h} (${buf.length} bytes) meta=${JSON.stringify(meta)}`);
    await this.replicate(h, buf.toString("base64"));
    return h;
  }

  private dynamicPeers(): Peer[] {
    // union(seeds, discovered) - {self}
    const map = new Map<string, Peer>();
    for (const p of this.seeds) map.set(peerId(p), p);
    for (const p of this.discovery.getPeers()) map.set(peerId(p), p);
    map.delete(this.selfId);
    return Array.from(map.values());
  }

  async replicate(hash: string, rawB64: string) {
    // rf === 0 => replicate to ALL known peers
    const targets = this.dynamicPeers();
    const limit = this.rf === 0 ? Number.POSITIVE_INFINITY : this.rf;
    let successes = (await this.storage.has(hash)) ? 1 : 0;

    for (const p of targets) {
      if (successes >= limit) break;
      try {
        const r = await rpc(p[0], p[1], {
          type: "store",
          hash,
          data: rawB64,
          via: this.selfId,
        } as any);
        if (r && r.type === "ok") {
          successes += 1;
          this.metrics.event("replicate_ok", { to: `${p[0]}:${p[1]}`, hash });
          console.log(`[replicate_ok] -> ${p[0]}:${p[1]} ${hash}`);
        } else {
          this.metrics.event("replicate_fail", { to: `${p[0]}:${p[1]}`, hash });
          console.warn(`[replicate_fail] -> ${p[0]}:${p[1]} ${hash}`);
        }
      } catch {
        this.metrics.event("replicate_err", { to: `${p[0]}:${p[1]}`, hash });
        console.warn(`[replicate_err] -> ${p[0]}:${p[1]} ${hash}`);
      }
    }
  }

  async handle(sock: net.Socket) {
    let buf = "";
    sock.on("data", async (d) => {
      buf += d.toString("utf8");
      const i = buf.indexOf("\n");
      if (i === -1) return;
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let msg: Msg | null = null;
      try {
        msg = JSON.parse(line) as Msg;
      } catch {}
      if (!msg) {
        sendMsg(sock, { type: "error", error: "bad_json" });
        sock.end();
        return;
      }
      const peername = `${sock.remoteAddress}:${sock.remotePort}`;

      if (msg.type === "ping") {
        sendMsg(sock, { type: "pong" });
        sock.end();
        return;
      }

      if (msg.type === "have") {
        const hv = await this.storage.has(msg.hash);
        sendMsg(sock, { type: "have", hash: msg.hash, have: hv });
        sock.end();
        return;
      }

      if (msg.type === "peers") {
        const peersStr = this.dynamicPeers().map((p) => `${p[0]}:${p[1]}`);
        sendMsg(sock, { type: "peers", peers: peersStr } as any);
        sock.end();
        return;
      }

      if (msg.type === "store") {
        const raw = Buffer.from((msg as any).data, "base64");
        try {
          await this.storage.put(msg.hash, raw, (msg as any).meta || {});
          this.metrics.bytesIn += raw.length;
          this.metrics.event("store", {
            from_: peername,
            hash: msg.hash,
            size: raw.length,
          });
          sendMsg(sock, { type: "ok", stored: msg.hash });
          sock.end();
          // Only replicate when this is an origin store (no 'via' field)
          if (!(msg as any).via) this.replicate(msg.hash, (msg as any).data);
        } catch (e: any) {
          sendMsg(sock, { type: "error", error: e?.message || "store_error" });
          sock.end();
        }
        return;
      }

      if (msg.type === "fetch") {
        const raw = await this.storage.get(msg.hash);
        if (!raw) {
          sendMsg(sock, { type: "missing", hash: msg.hash });
          sock.end();
          return;
        }
        const b64 = raw.toString("base64");
        sendMsg(sock, { type: "found", hash: msg.hash, data: b64 });
        this.metrics.bytesOut += raw.length;
        this.metrics.event("fetch", {
          to: peername,
          hash: msg.hash,
          size: raw.length,
        });
        sock.end();
        return;
      }

      sendMsg(sock, { type: "error", error: "unknown_type" });
      sock.end();
    });
    sock.on("error", () => {
      try {
        sock.destroy();
      } catch {}
    });
  }

  async serve(): Promise<void> {
    await this.storage.ensure();
    const srv = net.createServer((sock) => this.handle(sock));
    await new Promise<void>((res) =>
      srv.listen(this.port, "0.0.0.0", () => res())
    );
    console.log(`[node] listening on 0.0.0.0:${this.port}`);
    this.discovery.start();
    this.monitorPeers().catch(() => {});
  }

  private async monitorPeers() {
    while (true) {
      for (const p of this.dynamicPeers()) {
        const id = peerId(p);
        const t0 = Date.now();
        let alive = false;
        let latency: number | null = null;
        let neighbors: string[] = [];
        try {
          const pong = await rpc(p[0], p[1], { type: "ping" });
          if (pong && pong.type === "pong") {
            alive = true;
            latency = Date.now() - t0;
            const pr = await rpc(p[0], p[1], { type: "peers" });
            if (pr && pr.type === "peers") neighbors = (pr as any).peers || [];
          }
        } catch {}
        this.peerState.set(id, {
          alive,
          latencyMs: latency,
          peers: neighbors,
          last: Date.now() / 1000,
        });
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  getMesh() {
    const dyn = this.dynamicPeers();
    const nodesSet = new Set<string>([this.selfId, ...dyn.map(peerId)]);
    for (const st of this.peerState.values())
      for (const n of st.peers) nodesSet.add(n);

    const nodes = Array.from(nodesSet).map((id) => {
      if (id === this.selfId) return { id, alive: true, latencyMs: 0 };
      const st = this.peerState.get(id);
      return { id, alive: !!st?.alive, latencyMs: st?.latencyMs ?? null };
    });

    const links: { source: string; target: string }[] = [];
    for (const p of dyn) links.push({ source: this.selfId, target: peerId(p) });
    for (const [id, st] of this.peerState)
      for (const n of st.peers) links.push({ source: id, target: n });

    const key = (e: { source: string; target: string }) =>
      `${e.source}=>${e.target}`;
    const dedup = new Map<string, { source: string; target: string }>();
    for (const e of links) dedup.set(key(e), e);

    return {
      self: this.selfId,
      nodes,
      links: Array.from(dedup.values()),
      updated_s: Math.floor(Date.now() / 1000),
    };
  }
}
