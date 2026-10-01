/** True when a key event comes from a text field, so game shortcuts must stay out of the way. */
export const isTyping = (target: EventTarget | null) =>
  Boolean(document.querySelector('[data-character-creator]')) ||
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
