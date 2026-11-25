// Small helpers for building the menus and panels by hand: an element with text and a class, a
// button that does not let its click through to what is behind, and the close (×) and back (←)
// buttons in a paper panel's top corners.

export interface Builder {
  /** Adds a `tag` to `parent` (the builder's box by default), with text and a class if given. */
  add<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, parent?: HTMLElement, cls?: string): HTMLElementTagNameMap[K];
  /** Adds a button; its click goes no further than `onClick`. */
  button(text: string, onClick: () => void, parent?: HTMLElement, cls?: string): HTMLButtonElement;
}

/** Helpers that add to `box` unless told otherwise. */
export function builder(box: HTMLElement): Builder {
  const add = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', parent: HTMLElement = box, cls = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    if (cls) e.className = cls;
    parent.append(e);
    return e;
  };
  const button = (text: string, onClick: () => void, parent: HTMLElement = box, cls = ''): HTMLButtonElement => {
    const b = add('button', text, parent, cls);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  };
  return { add, button };
}

/**
 * The × in a panel's top right corner, staying in view while the panel scrolls. Put first in
 * the panel. Without `onClick` the click goes on to the panel (the credits close on any click).
 */
export function closeButton(parent: HTMLElement, onClick?: () => void, title = 'Close'): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'close';
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  if (onClick) {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
  }
  parent.prepend(b);
  return b;
}

/** The ← in a panel's top left corner, back to where it was opened from. Put first in the panel. */
export function backButton(parent: HTMLElement, onClick: () => void, title = 'Back'): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'go-back';
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M13.5 8H3M7.5 3.5L3 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  parent.prepend(b);
  return b;
}

/** A finger rather than a mouse: a phone or tablet. */
export const coarsePointer = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
