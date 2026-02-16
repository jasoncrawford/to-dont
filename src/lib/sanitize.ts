const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:'];

export function sanitizeHTML(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  sanitizeNode(div);
  return div.innerHTML;
}

function sanitizeNode(node: Node): void {
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      const tag = el.tagName.toLowerCase();

      if (tag === 'script' || tag === 'style') {
        el.remove();
        continue;
      }

      if (tag === 'a') {
        // Strip all attributes except href, then validate href
        const href = el.getAttribute('href') || '';
        let valid = false;
        try {
          const url = new URL(href, window.location.href);
          valid = ALLOWED_PROTOCOLS.includes(url.protocol);
        } catch {
          valid = false;
        }
        if (!valid) {
          // Unwrap invalid link
          unwrapElement(el);
          continue;
        }
        // Remove all attributes, re-add only allowed ones
        const attrs = Array.from(el.attributes);
        for (const attr of attrs) {
          el.removeAttribute(attr.name);
        }
        el.setAttribute('href', href);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener');
        // Recurse into anchor children
        sanitizeNode(el);
      } else {
        // Unwrap: replace element with its children
        unwrapElement(el);
      }
    }
  }
}

function unwrapElement(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  // Recurse into children first (they'll become siblings)
  sanitizeNode(el);
  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el);
  }
  el.remove();
}

export function isURL(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text);
}

export function textLengthOfHTML(html: string): number {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || '').length;
}
