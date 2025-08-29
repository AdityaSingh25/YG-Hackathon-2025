"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256Bytes = sha256Bytes;
exports.b64u = b64u;
exports.de64u = de64u;
exports.randomBytes = randomBytes;
const crypto_1 = require("crypto");
function sha256Bytes(buf) {
    return (0, crypto_1.createHash)('sha256').update(buf).digest('hex');
}
function b64u(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function de64u(s) {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
    return Buffer.from(b64, 'base64');
}
function randomBytes(n) {
    return (0, crypto_1.randomBytes)(n);
}
