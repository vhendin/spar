// What the start screen and the menu share about the drivers: the paints to choose from, and
// the list of who is connected.

/** Paints a driver may choose for their vehicle, one of each hue so drivers tell each other apart; '' keeps its own colours. */
export const PAINTS: { name: string; color: string }[] = [
  { name: 'Its own colours', color: '' },
  { name: 'Falu red', color: '#8e3b2d' },
  { name: 'Rowan orange', color: '#c8642a' },
  { name: 'Mustard', color: '#c9a44a' },
  { name: 'Spruce green', color: '#3e6b48' },
  { name: 'Lake blue', color: '#3f6f9e' },
  { name: 'Heather', color: '#6f4a7e' },
  { name: 'Birch white', color: '#dcdad2' },
  { name: 'Night', color: '#262c38' },
];

export interface PlayerLine {
  id: string;
  name: string;
  color: string;
  /** Driving in the same region as us. */
  here: boolean;
  you: boolean;
  paused: boolean;
  /** The region they are in, by name; '' before they have entered one. */
  region: string;
  /** On the road somewhere, so there is a vehicle to join. */
  driving: boolean;
}

export interface PlayerListOptions {
  /** A region's title from its name. */
  titleOf?: (region: string) => string;
  /** Offered for everyone else on the road: set off behind them. */
  join?: (id: string) => void;
}

/** Fills `parent` with one line per player, or says it is just us. */
export function fillPlayers(parent: HTMLElement, players: PlayerLine[], regionTitle: string, options: PlayerListOptions = {}): void {
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
    const elsewhere = p.region ? (options.titleOf?.(p.region) ?? p.region) : 'not driving yet';
    where.textContent = p.you ? 'you' : p.here ? (p.paused ? `${regionTitle} · paused` : regionTitle) : elsewhere;
    line.append(dot, name, where);
    if (!p.you && p.driving && options.join) {
      const join = document.createElement('button');
      join.className = 'join';
      join.textContent = 'Join';
      join.title = `Set off just behind ${p.name}${p.here ? '' : `, in ${elsewhere}`}`;
      join.addEventListener('click', (e) => {
        e.stopPropagation();
        options.join!(p.id);
      });
      line.append(join);
    }
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
