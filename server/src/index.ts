import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { loadConfig } from './config';
import { createGameServer } from './server';

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

const config = loadConfig();
const server = createGameServer(config);

server.listen().then(
  (addr) => {
    console.log(`Spår server: region "${config.region}", seed ${config.seed}`);
    console.log(`  this computer: http://localhost:${addr.port}`);
    if (existsSync('/.dockerenv')) {
      // Inside a container the interfaces are Docker's own, not the host's.
      console.log('  on the LAN:    http://<this computer\'s IP address>:<published port>');
    } else {
      for (const ip of lanAddresses()) console.log(`  on the LAN:    http://${ip}:${addr.port}`);
    }
  },
  (err: unknown) => {
    console.error('Could not start the server:', err);
    process.exit(1);
  },
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close().finally(() => process.exit(0));
  });
}
