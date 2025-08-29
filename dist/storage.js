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
exports.Storage = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const hashutil_1 = require("./hashutil");
class Storage {
    constructor(root) {
        this.root = root;
    }
    p(h) { return path.join(this.root, h); }
    idxPath() { return path.join(this.root, 'index.json'); }
    async ensure() {
        await fs.mkdir(this.root, { recursive: true });
        try {
            await fs.access(this.idxPath());
        }
        catch {
            await fs.writeFile(this.idxPath(), '{}', 'utf8');
        }
    }
    async has(h) {
        try {
            await fs.access(this.p(h));
            return true;
        }
        catch {
            return false;
        }
    }
    async put(h, data, meta = {}) {
        await this.ensure();
        if ((0, hashutil_1.sha256Bytes)(data) !== h)
            throw new Error('hash_mismatch');
        await fs.writeFile(this.p(h), data);
        await this.updateIndex(h, data.length, meta);
    }
    async get(h) {
        try {
            return await fs.readFile(this.p(h));
        }
        catch {
            return null;
        }
    }
    async updateIndex(h, size, meta) {
        let idx = {};
        try {
            idx = JSON.parse(await fs.readFile(this.idxPath(), 'utf8'));
        }
        catch { }
        idx[h] = { size, meta, ts: Date.now() / 1000 };
        await fs.writeFile(this.idxPath(), JSON.stringify(idx, null, 2), 'utf8');
    }
    async list() {
        try {
            return JSON.parse(await fs.readFile(this.idxPath(), 'utf8'));
        }
        catch {
            return {};
        }
    }
}
exports.Storage = Storage;
