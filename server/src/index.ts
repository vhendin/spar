import { existsSync } from 'node:fs';
import { loadConfig } from './config';
import { lanIps } from './lan';
import { createGameServer } from './server';

const config = loadConfig();
const server = createGameServer(config);

server.listen().then(
  (addr) => {
    console.log(`Spår server: region "${config.region}", seed ${config.seed}`);
    console.log(`  this computer: http://localhost:${addr.port}`);
    if (config.addresses) for (const a of config.addresses) console.log(`  friends join:  ${a}`);
    else if (existsSync('/.dockerenv')) {
      // Inside a container the interfaces are Docker's own, not the host's.
      console.log('  on the LAN:    http://<this computer\'s IP address>:<published port> (set ADDRESS to show it in the start menu)');
    } else {
      for (const ip of lanIps()) console.log(`  on the LAN:    http://${ip}:${addr.port}`);
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
