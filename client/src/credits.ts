// The credits screen (C): who made the data the world is built from, and the software it runs on.

import type { RegionIndex } from '@spar/shared';
import { closeButton, coarsePointer } from './ui/dom';

/** Software in the game itself, with its licence. */
const SOFTWARE = [
  'three.js — MIT licence',
  'Rapier physics (@dimforge/rapier3d-compat) — Apache License 2.0',
  'ws — MIT licence',
  'Ajv — MIT licence',
  'Inter and Instrument Serif typefaces — SIL Open Font License 1.1',
];

/** Data used everywhere, not per region. */
const SKY = ['Stars: Yale Bright Star Catalogue, 5th revised edition (Hoffleit & Warren, 1991), public domain'];

/** Fills the credits panel for a region; `index` null before a region has loaded. */
export function fillCredits(panel: HTMLElement, index: RegionIndex | null): void {
  const box = document.createElement('div');
  const add = (tag: string, text: string, parent: HTMLElement = box): HTMLElement => {
    const el = document.createElement(tag);
    el.textContent = text;
    parent.appendChild(el);
    return el;
  };
  add('h1', 'Spår');
  add('p', index ? `${index.title}: a real piece of the Swedish mountains, built from open data.` : 'A real piece of the Swedish mountains, built from open data.');
  add('h2', 'Map and terrain data');
  const data = add('ul', '');
  for (const line of [...(index?.attribution ?? ['Loading the region…']), ...SKY]) add('li', line, data);
  add('h2', 'Software');
  const software = add('ul', '');
  for (const line of SOFTWARE) add('li', line, software);
  add('p', 'Every tree, rock, house and fence is generated in your browser from these data; nothing comes from the internet while you play.');
  add('p', coarsePointer() ? 'Tap anywhere to close.' : 'Click, C or Esc to close.').className = 'hint';
  // Any click closes the credits, so the × needs nothing of its own.
  closeButton(box);
  panel.replaceChildren(box);
}
