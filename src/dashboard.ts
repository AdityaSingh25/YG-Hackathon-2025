import express from "express";
import multer from "multer";
import * as zlib from "zlib";
import type { Node } from "./node";
import { encryptAESGCM } from "./crypto";
import { makeShareLink, parseShareLink, fetchBytes } from "./client";
import { rpc } from "./protocol";

const upload = multer({ storage: multer.memoryStorage() });

const DASH_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>P2P Node Dashboard</title>
  <style>
    body { font-family: system-ui, Arial; margin: 20px; max-width: 1100px; }
    h1 { margin-bottom: 8px; }
    .grid { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .card { border:1px solid #ddd; border-radius: 12px; padding:12px;}
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 12px;}
    code { background:#f6f6f6; padding:2px 4px; border-radius:6px;}
    label { font-size: 12px; }
    input[type=file] { font-size: 12px; }
    button { padding: 6px 10px; border:1px solid #ddd; border-radius:8px; background:#fafafa; cursor:pointer; }
    .row { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 980px) { .row { grid-template-columns: 1fr; } }
    .err { color: #b91c1c; }
  </style>
</head>
<body>
  <h1>P2P Node Dashboard</h1>
  <div id="status" style="margin:8px 0;padding:8px;border:1px solid #eee;border-radius:8px;font-size:12px">
    status: metrics <span id="s-m">–</span> · mesh <span id="s-g">–</span> · last error: <span id="s-e">none</span>
  </div>

  <div class="row">
    <div class="card">
      <h3>Stats</h3>
      <div id="stats"></div>
      <h3>Peers</h3>
      <ul id="peers"></ul>
      <div id="meshErr" class="err"></div>
    </div>

    <div class="card">
      <h3>Upload</h3>
      <form id="upf">
        <input type="file" id="file" required />
        <div style="margin:8px 0">
          <label><input type="checkbox" id="enc" checked /> Encrypt (AES-GCM)</label>
          <label style="margin-left:12px"><input type="checkbox" id="zip" /> Compress (deflate)</label>
        </div>
        <button type="submit">Upload</button>
      </form>
      <div id="upres" style="margin-top:10px;font-size:12px"></div>

      <h3 style="margin-top:16px">Retrieve</h3>
      <div>
        <input id="link" placeholder="dfs://... or raw hash" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:8px;font-size:12px" />
        <div style="margin-top:8px">
          <button id="btnByLink">Download by Link</button>
          <button id="btnByHash" style="margin-left:8px">Download by Hash</button>
        </div>
      </div>
    </div>
  </div>

  <div class="card" style="margin-top:12px">
    <h3>Recent Transfers</h3>
    <table id="tbl">
      <thead><tr><th>When</th><th>Kind</th><th>Hash</th><th>Peer</th><th>Size</th></tr></thead>
      <tbody></tbody>
    </table>
  </div>

  <div class="card" id="filesCard" style="margin-top:12px">
    <h3>Local Files</h3>
    <table id="filesTbl">
      <thead><tr><th>Hash</th><th>Size</th><th>When</th></tr></thead>
      <tbody></tbody>
    </table>
  </div>

  <div class="card" style="margin-top:12px">
    <h3>Mesh</h3>
    <canvas id="mesh" width="700" height="380" style="width:100%;border-radius:12px"></canvas>
  </div>

  <script>
    function drawMesh(mesh) {
      const cvs = document.getElementById('mesh');
      const ctx = cvs.getContext('2d');
      const W = cvs.width, H = cvs.height;
      ctx.clearRect(0,0,W,H);
      const nodes = (mesh && mesh.nodes) ? mesh.nodes.slice().sort((a,b)=>a.id.localeCompare(b.id)) : [];
      const n = nodes.length || 1;
      const cx = W/2, cy = H/2, R = Math.max(120, Math.min(W,H)/2 - 30);
      const pos = {};
      nodes.forEach((node, i) => {
        const ang = (2*Math.PI*i)/n - Math.PI/2;
        pos[node.id] = { x: cx + R*Math.cos(ang), y: cy + R*Math.sin(ang) };
      });
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5;
      (mesh.links||[]).forEach(e => { const a=pos[e.source], b=pos[e.target]; if(!a||!b) return; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); });
      nodes.forEach(node => {
        const p = pos[node.id], alive = !!node.alive, isSelf = node.id===mesh.self, r = isSelf?9:7;
        ctx.beginPath(); ctx.arc(p.x,p.y,r,0,2*Math.PI); ctx.fillStyle = alive?'#22c55e':'#d1d5db'; ctx.fill();
        ctx.strokeStyle = '#111827'; ctx.lineWidth = isSelf?2:1; ctx.stroke();
        ctx.fillStyle = '#111827'; ctx.font = '11px system-ui, -apple-system, Segoe UI, Arial';
        const label = (isSelf ? '• ' : '') + node.id + (node.latencyMs?(' ('+node.latencyMs+'ms)'):'');
        ctx.fillText(label, p.x+10, p.y-10);
      });
    }

    function S(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

    async function refresh() {
      // METRICS
      try {
        const r = await fetch('/metrics', { cache: 'no-store' });
        if (!r.ok) throw new Error('metrics ' + r.status);
        const m = await r.json();
        S('s-m', 'ok');

        document.getElementById('stats').innerHTML =
          'Uptime: ' + m.uptime_s + 's<br>' +
          'Bytes In: ' + m.bytes_in + '<br>' +
          'Bytes Out: ' + m.bytes_out;
        document.getElementById('peers').innerHTML = (m.peers||[]).map(p => '<li><code>'+p+'</code></li>').join('');
        const rows = (m.recent||[]).map(e => {
          const when = new Date(e.ts*1000).toLocaleTimeString();
          const peer = e.kind==='store' ? (e.from_||'') : (e.to||'');
          const size = e.size || '';
          const h = (e.hash||'').slice(0,10) + '…';
          return '<tr><td>'+when+'</td><td>'+e.kind+'</td><td><code>'+h+'</code></td><td>'+peer+'</td><td>'+size+'</td></tr>';
        }).reverse().join('');
        document.querySelector('#tbl tbody').innerHTML = rows;
        const frows = Object.entries(m.files || {}).map(([h, info]) => {
          const when = new Date(info.ts*1000).toLocaleTimeString();
          return '<tr><td><code>'+h.slice(0,10)+'…</code></td><td>'+info.size+'</td><td>'+when+'</td></tr>';
        }).reverse().join('');
        document.querySelector('#filesTbl tbody').innerHTML = frows;
      } catch (e) {
        S('s-m', 'fail'); S('s-e', (e && e.message) || String(e));
        console.error('metrics error', e);
      }

      // MESH
      try {
        const mr = await fetch('/mesh', { cache: 'no-store' });
        if (!mr.ok) throw new Error('mesh ' + mr.status);
        const mesh = await mr.json();
        S('s-g', 'ok');
        drawMesh(mesh);
        document.getElementById('meshErr').textContent = '';
      } catch (e) {
        S('s-g', 'fail'); S('s-e', (e && e.message) || String(e));
        console.error('mesh error', e);
        document.getElementById('meshErr').textContent = 'Mesh not available yet…';
      }
    }

    // Upload form
    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('upf').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = document.getElementById('file');
        const enc = document.getElementById('enc'); const zip = document.getElementById('zip');
        if (!f.files || !f.files[0]) return;
        const fd = new FormData();
        fd.append('file', f.files[0]);
        fd.append('encrypt', enc.checked ? '1' : '0');
        fd.append('compress', zip.checked ? '1' : '0');
        try {
          const res = await fetch('/upload', { method: 'POST', body: fd, cache: 'no-store' });
          const j = await res.json();
          const el = document.getElementById('upres');
          if (j.error) { el.innerHTML = '<span class="err">Error: '+j.error+'</span>'; return; }
          const a = '<a href="/bylink?link='+encodeURIComponent(j.link)+'">Download</a>';
          const c = '<button id="copyBtn">Copy Link</button>';
          el.innerHTML = 'Stored <code>'+j.hash.slice(0,10)+'…</code> ('+j.size+' bytes)<br>Link: <code>'+j.link+'</code><br>'+a+' '+c;
          setTimeout(() => {
            const btn = document.getElementById('copyBtn');
            if (btn) btn.onclick = async () => {
              try { await navigator.clipboard.writeText(j.link); btn.textContent = 'Copied!'; } catch {}
            };
          }, 0);
          refresh();
        } catch (e) {
          document.getElementById('upres').innerHTML = '<span class="err">Upload failed</span>';
          S('s-e', (e && e.message) || String(e));
        }
      });

      document.getElementById('btnByLink').addEventListener('click', () => {
        const v = (document.getElementById('link') as HTMLInputElement).value.trim();
        if (!v) return; window.location.href = '/bylink?link='+encodeURIComponent(v);
      });
      document.getElementById('btnByHash').addEventListener('click', () => {
        const v = (document.getElementById('link') as HTMLInputElement).value.trim();
        if (!v) return; window.location.href = '/download/'+encodeURIComponent(v);
      });
    });

    window.addEventListener('error', (e) => {
      const msg = (e && e.message) || 'script error';
      console.error('window error', e);
      document.getElementById('s-e').textContent = msg;
    });

    setInterval(refresh, 1000);
    refresh();
  </script>
</body>
</html>`;

export function serveDashboard(node: Node, httpPort: number) {
  const app = express();

  // Log every request (verify browser is polling)
  app.use((req, _res, next) => {
    console.log(`[http] ${req.method} ${req.url}`);
    next();
  });

  // Root HTML: disable caching
  app.get("/", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.type("html").send(DASH_HTML);
  });

  // Metrics & mesh with no-cache headers
  app.get("/metrics", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    const d: any = node.metrics.toJSON();
    d.peers = node.getPeersList().map(([h, p]) => `${h}:${p}`);
    d.files = await node.storage.list();
    res.json(d);
  });

  app.get("/mesh", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(node.getMesh());
  });

  // Health & debug helpers
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.get("/debug/discovery", (_req, res) => {
    res.json({ peers: node.getPeersList().map(([h, p]) => `${h}:${p}`) });
  });
  app.get("/debug/ping", async (req, res) => {
    try {
      const to = String(req.query.to || "");
      const [host, portStr] = to.split(":");
      const port = Number(portStr);
      const t0 = Date.now();
      const r = await rpc(host, port, { type: "ping" });
      if (r && r.type === "pong")
        return res.json({ ok: true, latency_ms: Date.now() - t0 });
      res.status(500).json({ ok: false, error: "no pong" });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "ping_fail" });
    }
  });

  // ---- Upload (multipart) ----
  app.post("/upload", upload.single("file"), async (req, res) => {
    try {
      const f = (req as any).file;
      if (!f) return res.status(400).json({ error: "no_file" });

      const encrypt = String(req.body.encrypt || "0") === "1";
      const compress = String(req.body.compress || "0") === "1";
      const name = String(f.originalname || "file.bin");

      let data: Buffer = f.buffer;
      const meta: any = { name };
      if (compress) {
        data = zlib.deflateSync(data, { level: 6 });
        meta.zip = "deflate";
      }

      let hash = "";
      let link = "";
      if (encrypt) {
        const { ct, key, iv } = encryptAESGCM(data);
        hash = await node.storeLocalAndReplicate(ct, {
          ...meta,
          enc: "aesgcm",
        });
        link = makeShareLink(hash, name, key, iv);
      } else {
        hash = await node.storeLocalAndReplicate(data, meta);
        link = makeShareLink(hash, name);
      }
      console.log(`[upload] ok ${hash} (${data.length} bytes) -> ${link}`);
      return res.json({ hash, link, size: data.length });
    } catch (e: any) {
      console.error("[upload] failed", e?.message || e);
      return res.status(500).json({ error: e?.message || "upload_failed" });
    }
  });

  // ---- Download by raw hash (local-first, network fallback) ----
  app.get("/download/:hash", async (req, res) => {
    try {
      const h = String(req.params.hash);
      let buf = await node.storage.get(h);
      if (!buf) {
        const peers = node.getPeersList();
        if (!peers.length) return res.status(404).send("not found (no peers)");
        buf = await fetchBytes(peers, h);
        await node.storage.put(h, buf, { name: h }); // local cache
      }
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${h}.bin"`);
      res.send(buf);
    } catch {
      res.status(404).send("not found");
    }
  });

  // ---- Download via dfs:// link (auto-decrypt) ----
  app.get("/bylink", async (req, res) => {
    try {
      const link = String(req.query.link || "");
      if (!link.startsWith("dfs://")) return res.status(400).send("bad link");
      const { cid, key, iv, name } = parseShareLink(link);
      const peers = node.getPeersList();
      let buf = await fetchBytes(peers, cid);
      if (key && iv) {
        const { decryptAESGCM } = await import("./crypto");
        buf = decryptAESGCM(buf, key, iv);
      }
      const filename = name || cid + ".bin";
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.send(buf);
    } catch {
      res.status(404).send("download failed");
    }
  });

  app.listen(httpPort, "0.0.0.0", () => {
    console.log(`[dashboard] http://127.0.0.1:${httpPort}`);
  });
}
