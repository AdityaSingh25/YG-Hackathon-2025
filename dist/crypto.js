"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptAESGCM = encryptAESGCM;
exports.decryptAESGCM = decryptAESGCM;
const crypto_1 = require("crypto");
const hashutil_1 = require("./hashutil");
function encryptAESGCM(plaintext) {
    const key = (0, hashutil_1.randomBytes)(32);
    const iv = (0, hashutil_1.randomBytes)(12);
    const cipher = (0, crypto_1.createCipheriv)('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { ct: Buffer.concat([ct, tag]), key, iv };
}
function decryptAESGCM(cipherAndTag, key, iv) {
    const ct = cipherAndTag.slice(0, cipherAndTag.length - 16);
    const tag = cipherAndTag.slice(cipherAndTag.length - 16);
    const decipher = (0, crypto_1.createDecipheriv)('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
}
