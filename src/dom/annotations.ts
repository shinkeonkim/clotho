function referencedIds(target: EventTarget | null): string[] {
  if (!(target instanceof Element)) return [];
  const token = target.closest<HTMLElement>('[data-clotho-ref]');
  return token?.dataset.clothoRef?.split(/\s+/).filter(Boolean) ?? [];
}

function annotationElement(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-clotho-ref]') : null;
}

/** Append annotation-aware text without accepting HTML from a document. */
export function appendAnnotationText(
  container: HTMLElement,
  value: string,
  references: Readonly<Record<string, string | readonly string[]>>,
): void {
  container.replaceChildren();
  for (const part of splitAnnotations(value, references)) {
    if (part.kind === 'text' || part.targetIds?.length === 0) {
      container.append(document.createTextNode(part.value));
      continue;
    }
    const reference = document.createElement('span');
    reference.textContent = part.value;
    reference.dataset.clothoRef = part.targetIds?.join(' ');
    reference.dataset.clothoToken = part.token;
    reference.tabIndex = 0;
    reference.setAttribute('role', 'link');
    reference.setAttribute('aria-label', `${part.value}: ${part.targetIds?.join(', ')}`);
    container.append(reference);
  }
}

export function activateAnnotation(root: HTMLElement, target: EventTarget | null): void {
  const ids = new Set(referencedIds(target));
  root.querySelectorAll<HTMLElement>('[data-clotho-id]').forEach((element) => {
    element.classList.toggle('is-annotation-target', ids.has(element.dataset.clothoId ?? ''));
  });
  root.querySelectorAll<HTMLElement>('[data-clotho-ref]').forEach((element) => {
    element.classList.toggle(
      'is-annotation-active',
      target instanceof Node && element.contains(target),
    );
  });
}

export function clearAnnotation(root: HTMLElement): void {
  root.querySelectorAll('.is-annotation-target, .is-annotation-active').forEach((element) => {
    element.classList.remove('is-annotation-target', 'is-annotation-active');
  });
}

export function bindAnnotations(root: HTMLElement): () => void {
  let pinned: HTMLElement | null = null;
  const activate = (event: Event): void => activateAnnotation(root, event.target);
  const restorePinned = (): void => {
    if (pinned && root.contains(pinned)) activateAnnotation(root, pinned);
    else clearAnnotation(root);
  };
  const click = (event: Event): void => {
    const next = annotationElement(event.target);
    pinned = next === pinned ? null : next;
    if (pinned) activateAnnotation(root, pinned);
    else clearAnnotation(root);
  };
  const keydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    pinned = null;
    clearAnnotation(root);
  };
  root.addEventListener('pointerover', activate);
  root.addEventListener('pointerout', restorePinned);
  root.addEventListener('focusin', activate);
  root.addEventListener('focusout', restorePinned);
  root.addEventListener('click', click);
  root.addEventListener('keydown', keydown);
  return () => {
    root.removeEventListener('pointerover', activate);
    root.removeEventListener('pointerout', restorePinned);
    root.removeEventListener('focusin', activate);
    root.removeEventListener('focusout', restorePinned);
    root.removeEventListener('click', click);
    root.removeEventListener('keydown', keydown);
    clearAnnotation(root);
  };
}
import { splitAnnotations } from '../core/annotations';
