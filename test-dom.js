/**
 * Minimal fake DOM, shared by test.js and test-recognizer.js.
 *
 * Just enough of the browser for app.js to run headlessly: elements, events,
 * localStorage, and a <canvas> that hands back real glyph bitmaps when the test
 * provides them.
 */
class El {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.attrs = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.textContent = '';
    this._class = '';
    this._html = '';
    this.parentElement = null;
  }
  get className() {
    return this._class;
  }
  set className(v) {
    this._class = v;
  }
  get classList() {
    const self = this;
    return {
      add: (...c) => {
        self._class = [...new Set([...self._class.split(' ').filter(Boolean), ...c])].join(' ');
      },
      remove: (...c) => {
        self._class = self._class.split(' ').filter((x) => x && !c.includes(x)).join(' ');
      },
      contains: (c) => self._class.split(' ').includes(c),
    };
  }
  get innerHTML() {
    return this._html;
  }
  set innerHTML(v) {
    this._html = v;
    this.children = [];
  }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  append(...kids) {
    kids.forEach((k) => this.appendChild(k));
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  fire(type, event = {}) {
    (this.listeners[type] || []).forEach((fn) =>
      fn({ target: this, preventDefault() {}, ...event }),
    );
  }
  descendants() {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  matches(sel) {
    return sel.startsWith('.') && this._class.split(' ').includes(sel.slice(1));
  }
  querySelectorAll(sel) {
    return this.descendants().filter((n) => n.matches(sel));
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
  closest(sel) {
    let node = this;
    while (node) {
      if (node.matches(sel)) return node;
      node = node.parentElement;
    }
    return null;
  }
  focus() {}
  setPointerCapture() {}
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return this.attrs[name] ?? null;
  }
}

/** A 2D context that "draws" by looking the character up in `bitmaps`. */
function fakeContext(bitmaps, box) {
  let current = '';
  const noop = () => {};
  return {
    textAlign: '',
    textBaseline: '',
    fillStyle: '',
    strokeStyle: '',
    font: '',
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
    measureText(text) {
      current = text;
      return {
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: box * 0.8,
        actualBoundingBoxAscent: box * 0.8,
        actualBoundingBoxDescent: 0,
      };
    },
    fillText(text) {
      current = text;
    },
    getImageData() {
      const grid = bitmaps[current] || [];
      const data = new Uint8ClampedArray(box * box * 4);
      for (let i = 0; i < grid.length; i += 1) data[i * 4 + 3] = grid[i] ? 255 : 0;
      return { data };
    },
    clearRect: noop,
    fillRect: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    arc: noop,
    fill: noop,
    setLineDash: noop,
    scale: noop,
  };
}

function asCanvas(element, bitmaps, box, cssSize) {
  element.width = box;
  element.height = box;
  element.clientWidth = cssSize;
  element.clientHeight = cssSize;
  element.getContext = () => fakeContext(bitmaps, box);
  element.getBoundingClientRect = () => ({ left: 0, top: 0, width: cssSize, height: cssSize });
  return element;
}

/**
 * Installs the fake DOM as globals and returns handles to it.
 * `glyphBitmaps` maps a character to a row-major 0/1 array of `box`×`box`.
 */
function createDom({ glyphBitmaps = {}, box = 64, padSize = 280 } = {}) {
  const registry = new Map();
  const memory = new Map();

  const document = {
    getElementById(elementId) {
      if (!registry.has(elementId)) {
        const element = new El();
        if (elementId === 'pad') asCanvas(element, glyphBitmaps, box, padSize);
        registry.set(elementId, element);
      }
      return registry.get(elementId);
    },
    createElement(tag) {
      const element = new El(tag);
      return tag === 'canvas' ? asCanvas(element, glyphBitmaps, box, padSize) : element;
    },
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    fireKey(key) {
      (this.listeners.keydown || []).forEach((fn) => fn({ key, preventDefault() {} }));
    },
  };
  document.body = new El('body');

  global.document = document;
  global.localStorage = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
  };
  global.getComputedStyle = () => ({ getPropertyValue: () => '#333333' });
  global.window = {
    // Synchronous on purpose: exercises the auto-advance path inside test loops.
    setTimeout: (fn) => fn(),
    scrollTo() {},
    confirm: () => true,
    devicePixelRatio: 1,
    addEventListener() {},
  };
  global.console.warn = () => {};

  return { El, document, registry, memory, id: (x) => document.getElementById(x) };
}

module.exports = { El, createDom };
