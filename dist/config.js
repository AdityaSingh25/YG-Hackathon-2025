"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePeer = parsePeer;
function parsePeer(s) {
    const i = s.lastIndexOf(':');
    if (i === -1)
        throw new Error('peer must be host:port');
    return [s.slice(0, i), Number(s.slice(i + 1))];
}
