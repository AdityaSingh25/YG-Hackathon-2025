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
exports.sendMsg = sendMsg;
exports.recvLine = recvLine;
exports.rpc = rpc;
const net = __importStar(require("net"));
function sendMsg(sock, msg) {
    sock.write(JSON.stringify(msg) + '\n');
}
function recvLine(sock, timeoutMs = 10000) {
    return new Promise((resolve) => {
        let buf = '';
        let done = false;
        const onData = (d) => { buf += d.toString('utf8'); const i = buf.indexOf('\n'); if (i !== -1) {
            cleanup();
            resolve(buf.slice(0, i));
        } };
        const onEnd = () => { if (!done) {
            cleanup();
            resolve(buf.length ? buf : null);
        } };
        const onErr = () => { cleanup(); resolve(null); };
        const cleanup = () => { done = true; sock.off('data', onData); sock.off('end', onEnd); sock.off('error', onErr); };
        sock.on('data', onData);
        sock.on('end', onEnd);
        sock.on('error', onErr);
        sock.setTimeout(timeoutMs, () => { cleanup(); resolve(null); });
    });
}
function rpc(host, port, msg, timeoutMs = 5000) {
    return new Promise((resolve) => {
        const sock = net.connect({ host, port }, () => sendMsg(sock, msg));
        const finish = (v) => { try {
            sock.destroy();
        }
        catch { } resolve(v); };
        sock.on('error', () => finish(null));
        recvLine(sock, timeoutMs).then((line) => {
            if (!line)
                return finish(null);
            try {
                finish(JSON.parse(line));
            }
            catch {
                finish({ type: 'error', error: 'bad_json' });
            }
        });
    });
}
