// The chat, low on the left: lines from the other drivers and from the server (who joined,
// who changed the weather), fading after a while. Enter opens a line to write in; Enter sends
// it, Esc puts it away.

/** Seconds a line stays before it fades, and how many are kept. */
const SHOWN = 14;
const KEEP = 8;

export class Chat {
  private readonly root: HTMLDivElement;
  private readonly log: HTMLDivElement;
  private readonly input: HTMLInputElement;

  constructor(parent: HTMLElement, private readonly send: (text: string) => void) {
    this.root = document.createElement('div');
    this.root.id = 'chat';
    this.log = document.createElement('div');
    this.log.className = 'log';
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.maxLength = 200;
    this.input.placeholder = 'Say something to everyone · Enter sends · Esc closes';
    this.root.append(this.log, this.input);
    parent.append(this.root);
    // Typing must not drive, steer or open panels; keyup still passes so held keys are let go.
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text) this.send(text);
        this.close();
      } else if (e.key === 'Escape') this.close();
    });
    this.input.addEventListener('blur', () => this.close());
  }

  get typing(): boolean {
    return this.root.classList.contains('typing');
  }

  open(): void {
    this.root.classList.add('typing');
    this.input.value = '';
    this.input.focus();
  }

  close(): void {
    if (!this.typing) return;
    this.root.classList.remove('typing');
    this.input.blur();
  }

  /** A line from a driver (`name`), or from the server when there is no name. */
  add(text: string, name?: string, color?: string): void {
    const line = document.createElement('div');
    line.className = name ? 'line' : 'line notice';
    if (name) {
      const who = document.createElement('span');
      who.className = 'who';
      if (color) who.style.setProperty('--player', color);
      who.textContent = name;
      line.append(who, ' ', text);
    } else line.textContent = text;
    this.log.append(line);
    while (this.log.children.length > KEEP) this.log.firstElementChild!.remove();
    window.setTimeout(() => line.classList.add('old'), SHOWN * 1000);
  }
}
