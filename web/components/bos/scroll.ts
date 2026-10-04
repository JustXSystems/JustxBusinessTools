/**
 * Scrolls `child` into view inside a horizontally scrolling `container` without
 * moving the page (unlike `scrollIntoView`). No-op when nothing overflows.
 */
export function revealInline(container: HTMLElement | null, child: Element | null | undefined): void {
  if (!container || !(child instanceof HTMLElement)) return;
  if (container.scrollWidth <= container.clientWidth) return;
  const box = container.getBoundingClientRect();
  const item = child.getBoundingClientRect();
  const pad = 16;
  if (item.left < box.left + pad) container.scrollLeft -= box.left + pad - item.left;
  else if (item.right > box.right - pad) container.scrollLeft += item.right - (box.right - pad);
}

/** Vertical counterpart of `revealInline` for scrolling lists (command palette, menus). */
export function revealBlock(container: HTMLElement | null, child: Element | null | undefined): void {
  if (!container || !(child instanceof HTMLElement)) return;
  if (container.scrollHeight <= container.clientHeight) return;
  const box = container.getBoundingClientRect();
  const item = child.getBoundingClientRect();
  if (item.top < box.top) container.scrollTop -= box.top - item.top;
  else if (item.bottom > box.bottom) container.scrollTop += item.bottom - box.bottom;
}
