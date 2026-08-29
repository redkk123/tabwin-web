/**
 * The smallest `document` the chart renderer actually touches, so its real SVG
 * output can be asserted in Node without a browser.
 *
 * This is a test double for the DOM, not a DOM: it records what the renderer
 * asked for and serializes it back in order. If the renderer ever starts using
 * a method that is not here, the test fails loudly rather than silently
 * skipping whatever that call was going to draw.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escape(value) {
  return String(value).replace(/[&<>"]/g, (character) => ESCAPES[character]);
}

class StubElement {
  constructor(name) {
    this.tagName = name;
    this.attributes = new Map();
    this.children = [];
    this.textContent = undefined;
    this.classList = {
      values: new Set(),
      add: (...names) => {
        for (const name of names) this.classList.values.add(name);
        this.setAttribute('class', [...this.classList.values].join(' '));
      },
      contains: (name) => this.classList.values.has(name),
    };
  }

  setAttribute(key, value) { this.attributes.set(key, String(value)); }

  getAttribute(key) { return this.attributes.get(key) ?? null; }

  append(...children) { this.children.push(...children); }

  /** Every descendant, this element included, in document order. */
  descendants() {
    return [this, ...this.children.flatMap((child) => child.descendants())];
  }

  findAll(tagName) {
    return this.descendants().filter((element) => element.tagName === tagName);
  }

  byClass(className) {
    return this.descendants().filter((element) => element.getAttribute('class') === className);
  }

  toXml() {
    const attributes = [...this.attributes.entries()]
      .map(([key, value]) => ` ${key}="${escape(value)}"`)
      .join('');
    const inner = this.textContent === undefined
      ? this.children.map((child) => child.toXml()).join('')
      : escape(this.textContent);
    return inner ? `<${this.tagName}${attributes}>${inner}</${this.tagName}>` : `<${this.tagName}${attributes}/>`;
  }
}

/** Installs the stub and returns a function that puts the previous global back. */
export function installSvgDom() {
  const previous = globalThis.document;
  globalThis.document = { createElementNS: (_namespace, name) => new StubElement(name) };
  return () => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  };
}

/** Text drawn under a given class, in the order the renderer emitted it. */
export function textsByClass(svg, className) {
  return svg.byClass(className).map((element) => element.textContent);
}
