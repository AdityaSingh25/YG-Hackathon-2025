export type Peer = [string, number];

export function parsePeer(s: string): Peer {
  const i = s.lastIndexOf(':');
  if (i === -1) throw new Error('peer must be host:port');
  return [s.slice(0, i), Number(s.slice(i + 1))];
}

export type Config = {
  listenPort: number;
  storageDir: string;
  peers: Peer[];
  replicationFactor: number;
  httpPort: number; // 0 disables
};
