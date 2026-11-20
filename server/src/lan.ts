import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

/**
 * Interfaces that are not a network friends sit on: bridges for virtual machines and
 * containers, and tunnels (VPNs, Tailscale).
 */
const VIRTUAL = /^(bridge|vmnet|vboxnet|docker|br-|veth|virbr|utun|tun|tap|tailscale|wg|zt|awdl|llw)/i;

/** This computer's IPv4 addresses on its own networks, leaving out loopback and virtual ones. */
export function lanIps(): string[] {
  const all = Object.entries(networkInterfaces()).flatMap(([name, list]) =>
    (list ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => ({ name, address: a.address })),
  );
  const real = all.filter((a) => !VIRTUAL.test(a.name));
  // Nothing but virtual ones (an unusual set-up): better those than nothing.
  return (real.length ? real : all).map((a) => a.address);
}

/**
 * The addresses others can open, for the start menu. Inside a container the interfaces are
 * Docker's own, not the host's, so there are none to tell (ADDRESS can say it instead).
 */
export function lanAddresses(): string[] {
  return existsSync('/.dockerenv') ? [] : lanIps();
}
