/**
 * Sanitising for description HTML.
 *
 * Descriptions are authored by signed-in teammates and rendered back as HTML, so
 * a stored `<script>` or an `onerror=` attribute would run for everyone who opens
 * the item. "Only teammates can write it" is not a security model — one
 * compromised account, or one AI-generated description containing markup, is
 * enough. Everything is filtered against an allowlist on the way in and out.
 */

/** Formatting we accept; everything else is unwrapped or dropped. */
const ALLOWED_TAGS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'BR', 'P', 'DIV',
  'UL', 'OL', 'LI', 'SPAN', 'FONT', 'CODE', 'PRE', 'H1', 'H2', 'H3', 'BLOCKQUOTE',
]);

/** Only styling attributes — never href, src, or any event handler. */
const ALLOWED_ATTRS = new Set(['style', 'color']);

/** Style declarations worth keeping; anything else could reposition or hide UI. */
const ALLOWED_STYLE_PROPS = new Set([
  'color', 'background-color', 'font-weight', 'font-style', 'text-decoration',
]);

function cleanStyle(value: string): string {
  return value
    .split(';')
    .map(part => part.trim())
    .filter(part => {
      const prop = part.split(':')[0]?.trim().toLowerCase();
      if (!prop || !ALLOWED_STYLE_PROPS.has(prop)) return false;
      // url(...) can reach the network; expression() is legacy script.
      return !/url\s*\(|expression\s*\(/i.test(part);
    })
    .join('; ');
}

function scrub(node: Element): void {
  for (const child of [...node.children]) scrub(child);

  if (!ALLOWED_TAGS.has(node.tagName)) {
    // Keep the text, lose the element — dropping the subtree would silently eat
    // content someone wrote.
    node.replaceWith(...node.childNodes);
    return;
  }

  for (const attr of [...node.attributes]) {
    const name = attr.name.toLowerCase();
    if (!ALLOWED_ATTRS.has(name)) {
      node.removeAttribute(attr.name);
      continue;
    }
    if (name === 'style') {
      const cleaned = cleanStyle(attr.value);
      if (cleaned) node.setAttribute('style', cleaned);
      else node.removeAttribute('style');
    }
  }
}

export function sanitizeRichText(html: string): string {
  if (!html) return '';
  if (typeof document === 'undefined') return '';
  // A detached template never executes scripts or fetches resources while parsing.
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  for (const el of [...tpl.content.querySelectorAll('script,style,iframe,object,embed,link,meta')]) {
    el.remove();
  }
  for (const el of [...tpl.content.children]) scrub(el);
  return tpl.innerHTML;
}

/** True when the value still looks like the plain text we used to store. */
export function isPlainText(value: string): boolean {
  return !/<[a-z][\s\S]*>/i.test(value);
}

/**
 * Descriptions written before rich text was added are plain strings whose line
 * breaks matter. Promote them to HTML so they do not collapse into one run-on
 * paragraph the first time they are opened.
 */
export function plainTextToHtml(value: string): string {
  if (!value) return '';
  if (!isPlainText(value)) return value;
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}
