// What the start screen and the menu share about the drivers: the paints to choose from, and
// the list of who is connected.

/** Paints a driver may choose for their vehicle, from the game's palette; '' keeps its own colours. */
export const PAINTS: { name: string; color: string }[] = [
  { name: 'Its own colours', color: '' },
  { name: 'Falu red', color: '#8e3b2d' },
  { name: 'Mustard', color: '#c9a44a' },
  { name: 'Lake blue', color: '#4e6573' },
  { name: 'Moss', color: '#6e7a55' },
  { name: 'Birch white', color: '#dcdad2' },
  { name: 'Night', color: '#262c38' },
  { name: 'Rowan orange', color: '#b8562a' },
  { name: 'Lingon', color: '#7d2a3c' },
];

export interface PlayerLine {
  name: string;
  color: string;
  /** Driving in the same region as us. */
  here: boolean;
  you: boolean;
  paused: boolean;
}

/** Fills `parent` with one line per player, or says it is just us. */
export function fillPlayers(parent: HTMLElement, players: PlayerLine[], regionTitle: string): void {
  parent.replaceChildren();
  parent.classList.add('players');
  for (const p of players) {
    const line = document.createElement('div');
    line.className = 'player';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.color;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name;
    const where = document.createElement('span');
    where.className = 'where';
    where.textContent = p.you ? 'you' : p.here ? (p.paused ? `${regionTitle} · paused` : regionTitle) : 'elsewhere';
    line.append(dot, name, where);
    parent.append(line);
  }
}

/** Swatches for choosing a paint; `pick` gets the chosen colour ('' for the vehicle's own). */
export function paintSwatches(parent: HTMLElement, chosen: string, pick: (color: string) => void): void {
  const row = document.createElement('div');
  row.className = 'swatches';
  for (const paint of PAINTS) {
    const b = document.createElement('button');
    b.title = paint.name;
    if (paint.color) b.style.background = paint.color;
    else {
      b.className = 'own';
      b.textContent = 'Own';
    }
    if (paint.color === chosen) b.classList.add('on');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      pick(paint.color);
    });
    row.append(b);
  }
  parent.append(row);
}
