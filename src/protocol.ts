import * as net from 'net';

export type Msg =
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'have'; hash: string; have?: boolean }
  | { type: 'store'; hash: string; data: string; meta?: any; via?: string }  // <- via added
  | { type: 'ok'; stored: string }
  | { type: 'fetch'; hash: string }
  | { type: 'found'; hash: string; data: string }
  | { type: 'missing'; hash: string }
  | { type: 'peers' }
  | { type: 'peers'; peers: string[] }
  | { type: 'error'; error: string };

export function sendMsg(sock: net.Socket, msg: Msg) {
  sock.write(JSON.stringify(msg) + '\n');
}

export function recvLine(sock: net.Socket, timeoutMs = 10000): Promise<string | null> {
  return new Promise((resolve) => {
    let buf = ''; let done = false;
    const onData = (d: Buffer) => { buf += d.toString('utf8'); const i = buf.indexOf('\n'); if (i !== -1) { cleanup(); resolve(buf.slice(0, i)); } };
    const onEnd = () => { if (!done) { cleanup(); resolve(buf.length ? buf : null); } };
    const onErr = () => { cleanup(); resolve(null); };
    const cleanup = () => { done = true; sock.off('data', onData); sock.off('end', onEnd); sock.off('error', onErr); };
    sock.on('data', onData); sock.on('end', onEnd); sock.on('error', onErr);
    sock.setTimeout(timeoutMs, () => { cleanup(); resolve(null); });
  });
}

export function rpc(host: string, port: number, msg: Msg, timeoutMs = 5000): Promise<Msg | null> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port }, () => sendMsg(sock, msg));
    const finish = (v: Msg | null) => { try { sock.destroy(); } catch {} resolve(v); };
    sock.on('error', () => finish(null));
    recvLine(sock, timeoutMs).then((line) => {
      if (!line) return finish(null);
      try { finish(JSON.parse(line) as Msg); } catch { finish({ type: 'error', error: 'bad_json' }); }
    });
  });
}
