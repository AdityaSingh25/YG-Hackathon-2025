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
exports.Node = void 0;
const net = __importStar(require("net"));
const protocol_1 = require("./protocol");
const discovery_1 = require("./discovery");
const hashutil_1 = require("./hashutil");
class Metrics {
    constructor() {
        this.started = Date.now() / 1000;
        this.bytesIn = 0;
        this.bytesOut = 0;
        this.recent = [];
    }
    event(kind, extra = {}) {
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
function peerId(p) {
    return `${p[0]}:${p[1]}`;
}
class Node {
    constructor(port, storage, seeds = [], rf = 2, advertiseHost) {
        this.port = port;
        this.storage = storage;
        this.rf = rf;
        this.metrics = new Metrics();
        this.peerState = new Map();
        const host = advertiseHost || (0, discovery_1.pickLocalIPv4)();
        this.selfId = `${host}:${this.port}`;
        this.discovery = new discovery_1.Discovery(host, this.port);
        this.seeds = seeds;
    }
    // === Public helpers for dashboard / HTTP ===
    getPeersList() {
        return this.dynamicPeers();
    }
    async storeLocalAndReplicate(buf, meta = {}) {
        const h = (0, hashutil_1.sha256Bytes)(buf);
        await this.storage.put(h, buf, meta);
        this.metrics.bytesIn += buf.length;
        this.metrics.event("upload", { hash: h, size: buf.length });
        console.log(`[upload] stored ${h} (${buf.length} bytes) meta=${JSON.stringify(meta)}`);
        await this.replicate(h, buf.toString("base64"));
        return h;
    }
    dynamicPeers() {
        // union(seeds, discovered) - {self}
        const map = new Map();
        for (const p of this.seeds)
            map.set(peerId(p), p);
        for (const p of this.discovery.getPeers())
            map.set(peerId(p), p);
        map.delete(this.selfId);
        return Array.from(map.values());
    }
    async replicate(hash, rawB64) {
        // rf === 0 => replicate to ALL known peers
        const targets = this.dynamicPeers();
        const limit = this.rf === 0 ? Number.POSITIVE_INFINITY : this.rf;
        let successes = (await this.storage.has(hash)) ? 1 : 0;
        for (const p of targets) {
            if (successes >= limit)
                break;
            try {
                const r = await (0, protocol_1.rpc)(p[0], p[1], {
                    type: "store",
                    hash,
                    data: rawB64,
                    via: this.selfId,
                });
                if (r && r.type === "ok") {
                    successes += 1;
                    this.metrics.event("replicate_ok", { to: `${p[0]}:${p[1]}`, hash });
                    console.log(`[replicate_ok] -> ${p[0]}:${p[1]} ${hash}`);
                }
                else {
                    this.metrics.event("replicate_fail", { to: `${p[0]}:${p[1]}`, hash });
                    console.warn(`[replicate_fail] -> ${p[0]}:${p[1]} ${hash}`);
                }
            }
            catch {
                this.metrics.event("replicate_err", { to: `${p[0]}:${p[1]}`, hash });
                console.warn(`[replicate_err] -> ${p[0]}:${p[1]} ${hash}`);
            }
        }
    }
    async handle(sock) {
        let buf = "";
        sock.on("data", async (d) => {
            buf += d.toString("utf8");
            const i = buf.indexOf("\n");
            if (i === -1)
                return;
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            let msg = null;
            try {
                msg = JSON.parse(line);
            }
            catch { }
            if (!msg) {
                (0, protocol_1.sendMsg)(sock, { type: "error", error: "bad_json" });
                sock.end();
                return;
            }
            const peername = `${sock.remoteAddress}:${sock.remotePort}`;
            if (msg.type === "ping") {
                (0, protocol_1.sendMsg)(sock, { type: "pong" });
                sock.end();
                return;
            }
            if (msg.type === "have") {
                const hv = await this.storage.has(msg.hash);
                (0, protocol_1.sendMsg)(sock, { type: "have", hash: msg.hash, have: hv });
                sock.end();
                return;
            }
            if (msg.type === "peers") {
                const peersStr = this.dynamicPeers().map((p) => `${p[0]}:${p[1]}`);
                (0, protocol_1.sendMsg)(sock, { type: "peers", peers: peersStr });
                sock.end();
                return;
            }
            if (msg.type === "store") {
                const raw = Buffer.from(msg.data, "base64");
                try {
                    await this.storage.put(msg.hash, raw, msg.meta || {});
                    this.metrics.bytesIn += raw.length;
                    this.metrics.event("store", {
                        from_: peername,
                        hash: msg.hash,
                        size: raw.length,
                    });
                    (0, protocol_1.sendMsg)(sock, { type: "ok", stored: msg.hash });
                    sock.end();
                    // Only replicate when this is an origin store (no 'via' field)
                    if (!msg.via)
                        this.replicate(msg.hash, msg.data);
                }
                catch (e) {
                    (0, protocol_1.sendMsg)(sock, { type: "error", error: e?.message || "store_error" });
                    sock.end();
                }
                return;
            }
            if (msg.type === "fetch") {
                const raw = await this.storage.get(msg.hash);
                if (!raw) {
                    (0, protocol_1.sendMsg)(sock, { type: "missing", hash: msg.hash });
                    sock.end();
                    return;
                }
                const b64 = raw.toString("base64");
                (0, protocol_1.sendMsg)(sock, { type: "found", hash: msg.hash, data: b64 });
                this.metrics.bytesOut += raw.length;
                this.metrics.event("fetch", {
                    to: peername,
                    hash: msg.hash,
                    size: raw.length,
                });
                sock.end();
                return;
            }
            (0, protocol_1.sendMsg)(sock, { type: "error", error: "unknown_type" });
            sock.end();
        });
        sock.on("error", () => {
            try {
                sock.destroy();
            }
            catch { }
        });
    }
    async serve() {
        await this.storage.ensure();
        const srv = net.createServer((sock) => this.handle(sock));
        await new Promise((res) => srv.listen(this.port, "0.0.0.0", () => res()));
        console.log(`[node] listening on 0.0.0.0:${this.port}`);
        this.discovery.start();
        this.monitorPeers().catch(() => { });
    }
    async monitorPeers() {
        while (true) {
            for (const p of this.dynamicPeers()) {
                const id = peerId(p);
                const t0 = Date.now();
                let alive = false;
                let latency = null;
                let neighbors = [];
                try {
                    const pong = await (0, protocol_1.rpc)(p[0], p[1], { type: "ping" });
                    if (pong && pong.type === "pong") {
                        alive = true;
                        latency = Date.now() - t0;
                        const pr = await (0, protocol_1.rpc)(p[0], p[1], { type: "peers" });
                        if (pr && pr.type === "peers")
                            neighbors = pr.peers || [];
                    }
                }
                catch { }
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
        const nodesSet = new Set([this.selfId, ...dyn.map(peerId)]);
        for (const st of this.peerState.values())
            for (const n of st.peers)
                nodesSet.add(n);
        const nodes = Array.from(nodesSet).map((id) => {
            if (id === this.selfId)
                return { id, alive: true, latencyMs: 0 };
            const st = this.peerState.get(id);
            return { id, alive: !!st?.alive, latencyMs: st?.latencyMs ?? null };
        });
        const links = [];
        for (const p of dyn)
            links.push({ source: this.selfId, target: peerId(p) });
        for (const [id, st] of this.peerState)
            for (const n of st.peers)
                links.push({ source: id, target: n });
        const key = (e) => `${e.source}=>${e.target}`;
        const dedup = new Map();
        for (const e of links)
            dedup.set(key(e), e);
        return {
            self: this.selfId,
            nodes,
            links: Array.from(dedup.values()),
            updated_s: Math.floor(Date.now() / 1000),
        };
    }
}
exports.Node = Node;
