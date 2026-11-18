import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { validatedInput } from '../../../compat/runtime-ui.mjs';

const require = createRequire(import.meta.url);
const installWidget = require('../../../compat/inline-widget.cjs');
const createI18n = require('../../../compat/i18n.cjs');
const createTheme = require('../../../compat/theme.cjs');

test('validatedInput whitelists up to 4 normalized extraConversationIds', () => {
  const mainId = '11111111-1111-1111-1111-111111111111';
  const ids = [
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    'invalid-id',
    '44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555',
    '66666666-6666-6666-6666-666666666666',
  ];
  const parsed = validatedInput({
    conversationId: mainId,
    force: false,
    extraConversationIds: ids.map(s => s.toUpperCase()),
  });
  assert.deepEqual(parsed.extraConversationIds, [
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    '44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555',
  ]);
  assert.deepEqual(validatedInput({ conversationId: null, extraConversationIds: ['bad'] }), {
    conversationId: null,
    force: false,
  });
});

function createTestDom({ pathname = '/c/11111111-1111-1111-1111-111111111111' } = {}) {
  const splitSelector = sel => sel.split(',').map(s => s.trim()).filter(Boolean);

  function matchesSimple(el, part) {
    if (!el || el.nodeType !== 1) return false;
    let rem = part.trim();
    if (!rem) return false;
    if (rem.startsWith('*')) rem = rem.slice(1);
    const tagM = rem.match(/^([a-zA-Z0-9_-]+)/);
    if (tagM) {
      if (el.localName !== tagM[1].toLowerCase()) return false;
      rem = rem.slice(tagM[1].length);
    }
    while (rem.length) {
      if (rem[0] === '#') {
        const m = rem.slice(1).match(/^([a-zA-Z0-9_-]+)/);
        if (!m || el.id !== m[1]) return false;
        rem = rem.slice(1 + m[1].length);
      } else if (rem[0] === '.') {
        const m = rem.slice(1).match(/^([a-zA-Z0-9_-]+)/);
        if (!m || !el.classList.contains(m[1])) return false;
        rem = rem.slice(1 + m[1].length);
      } else if (rem[0] === '[') {
        const end = rem.indexOf(']');
        if (end === -1) return false;
        const inner = rem.slice(1, end);
        rem = rem.slice(end + 1);
        const eqIdx = inner.indexOf('=');
        if (eqIdx === -1) {
          if (!el.hasAttribute(inner)) return false;
        } else {
          let attrName = inner.slice(0, eqIdx);
          const op = attrName.endsWith('^') || attrName.endsWith('*') ? attrName.slice(-1) : '';
          if (op) attrName = attrName.slice(0, -1);
          const expected = inner.slice(eqIdx + 1).replace(/^["']|["']$/g, '');
          const actual = el.getAttribute(attrName);
          if (actual === null) return false;
          if (op === '^' && !actual.startsWith(expected)) return false;
          else if (op === '*' && !actual.includes(expected)) return false;
          else if (!op && actual !== expected) return false;
        }
      } else {
        return false;
      }
    }
    return true;
  }

  function matchesSelector(el, sel, rootScope = null) {
    for (let raw of splitSelector(sel)) {
      let scopeDirect = false;
      if (raw.startsWith(':scope > ')) {
        scopeDirect = true;
        raw = raw.slice(':scope > '.length);
      }
      if (scopeDirect && rootScope && el.parentElement !== rootScope) continue;
      if (!raw.includes(' ')) {
        if (matchesSimple(el, raw)) return true;
        continue;
      }
      const tokens = raw.split(/\s+/);
      if (!matchesSimple(el, tokens[tokens.length - 1])) continue;
      let cur = el.parentElement;
      let ti = tokens.length - 2;
      while (cur && ti >= 0) {
        if (matchesSimple(cur, tokens[ti])) ti--;
        cur = cur.parentElement;
      }
      if (ti < 0) return true;
    }
    return false;
  }

  class MiniClassList {
    constructor(el) { this.el = el; }
    _list() { return (this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
    contains(c) { return this._list().includes(c); }
    add(...cs) {
      const s = new Set(this._list());
      for (const c of cs) s.add(c);
      this.el.setAttribute('class', [...s].join(' '));
    }
    remove(...cs) {
      const s = new Set(this._list());
      for (const c of cs) s.delete(c);
      this.el.setAttribute('class', [...s].join(' '));
    }
    toggle(c, force) {
      const s = new Set(this._list());
      const has = s.has(c);
      const next = force !== undefined ? Boolean(force) : !has;
      if (next) s.add(c); else s.delete(c);
      this.el.setAttribute('class', [...s].join(' '));
      return next;
    }
  }

  class MiniNode {
    constructor(nodeType) {
      this.nodeType = nodeType;
      this.parentElement = null;
      this.parentNode = null;
    }
    get isConnected() {
      let cur = this;
      while (cur) {
        if (cur === doc.documentElement) return true;
        cur = cur.parentNode || cur.parentElement;
      }
      return false;
    }
    remove() {
      const p = this.parentNode || this.parentElement;
      if (p && Array.isArray(p.childNodes)) {
        const idx = p.childNodes.indexOf(this);
        if (idx >= 0) p.childNodes.splice(idx, 1);
      }
      this.parentNode = null;
      this.parentElement = null;
    }
  }

  class MiniText extends MiniNode {
    constructor(text = '') {
      super(3);
      this.nodeValue = String(text);
    }
    get textContent() { return this.nodeValue; }
    set textContent(v) { this.nodeValue = String(v); }
  }

  class MiniElement extends MiniNode {
    constructor(tag = 'div', attrs = {}) {
      super(1);
      this.localName = tag.toLowerCase();
      this.tagName = tag.toUpperCase();
      this.childNodes = [];
      this.attrs = new Map();
      this.dataset = new Proxy({}, {
        get: (_, key) => {
          const attr = 'data-' + String(key).replace(/[A-Z]/g, m => '-' + m.toLowerCase());
          return this.attrs.has(attr) ? this.attrs.get(attr) : undefined;
        },
        set: (_, key, val) => {
          const attr = 'data-' + String(key).replace(/[A-Z]/g, m => '-' + m.toLowerCase());
          this.setAttribute(attr, String(val));
          return true;
        },
      });
      this.classList = new MiniClassList(this);
      this.hidden = false;
      this.disabled = false;
      this.shadowRoot = null;
      this._rect = { left: 20, top: 20, width: 600, height: 28, right: 620, bottom: 48 };
      this.scrollWidth = 100;
      this.clientWidth = 100;
      this.offsetHeight = 28;
      this.clientHeight = 28;
      this.scrollHeight = 28;
      this._innerHTML = '';
      this.style = {
        _props: new Map(),
        setProperty: (k, v) => this.style._props.set(k, v),
        getPropertyValue: k => this.style._props.get(k) || '',
        cssText: '',
        visibility: '',
      };
      for (const [k, v] of Object.entries(attrs)) {
        if (v !== undefined && v !== null) this.setAttribute(k, v);
      }
    }
    get children() { return this.childNodes.filter(c => c.nodeType === 1); }
    get childElementCount() { return this.children.length; }
    get firstChild() { return this.childNodes[0] || null; }
    get nextSibling() {
      const p = this.parentNode || this.parentElement;
      if (!p) return null;
      const idx = p.childNodes.indexOf(this);
      return idx >= 0 && idx + 1 < p.childNodes.length ? p.childNodes[idx + 1] : null;
    }
    get previousElementSibling() {
      const p = this.parentNode || this.parentElement;
      if (!p) return null;
      const els = p.children;
      const idx = els.indexOf(this);
      return idx > 0 ? els[idx - 1] : null;
    }
    insertBefore(newNode, refNode) {
      newNode.remove?.();
      newNode.parentNode = this;
      newNode.parentElement = this.nodeType === 1 ? this : null;
      if (!refNode) {
        this.childNodes.push(newNode);
        return newNode;
      }
      const idx = this.childNodes.indexOf(refNode);
      if (idx >= 0) this.childNodes.splice(idx, 0, newNode);
      else this.childNodes.push(newNode);
      return newNode;
    }
    get id() { return this.getAttribute('id') || ''; }
    set id(v) { this.setAttribute('id', v); }
    get className() { return this.getAttribute('class') || ''; }
    set className(v) { this.setAttribute('class', v); }
    get attributes() {
      return Array.from(this.attrs.entries()).map(([name, value]) => ({ name, value }));
    }
    get textContent() {
      return this.childNodes.map(c => c.textContent || '').join('');
    }
    set textContent(v) {
      this.childNodes = v ? [new MiniText(v)] : [];
      if (this.childNodes[0]) {
        this.childNodes[0].parentNode = this;
        this.childNodes[0].parentElement = this.nodeType === 1 ? this : null;
      }
    }
    get innerHTML() { return this._innerHTML; }
    set innerHTML(v) {
      this._innerHTML = String(v || '');
      this._applyMarkup?.(this._innerHTML);
    }
    _applyMarkup(html) {
      this.childNodes = [];
      if (html.includes('class="ic-step')) {
        for (const m of html.matchAll(/class="ic-step\s+([^"]+)"\s+data-step-id="(\d+)"[\s\S]*?<span class="ic-title">([^<]*)<\/span>/g)) {
          const step = new MiniElement('div', { class: `ic-step ${m[1]}`, 'data-step-id': m[2] });
          step.textContent = m[3];
          this.append(step);
        }
        return;
      }
      if (html.includes('guide-heading')) {
        const h = new MiniElement('div', { class: 'guide-heading' });
        const st = new MiniElement('strong');
        const sp = new MiniElement('span');
        st.append(sp); h.append(st);
        const go = new MiniElement('div', { id: 'guide-open' });
        const hs = new MiniElement('span', { lang: 'zh-CN' });
        go.append(hs);
        const gc = new MiniElement('button', { id: 'guide-close' });
        const gsn = new MiniElement('div', { id: 'guide-save-note' });
        this.append(h, go, gc, gsn);
        return;
      }
      if (html.includes('chip')) {
        const bar = new MiniElement('div', { class: 'bar' });
        for (const card of ['speed', 'cache', 'context', 'task-progress']) {
          const c = new MiniElement('button', { class: 'chip', 'data-card': card });
          if (card === 'task-progress') c.id = 'task-chip';
          bar.append(c);
        }
        this.append(bar);
        for (const id of ['dot', 'tps', 'session-tps', 'latest-tps', 'samples', 'model-time', 'tool-time', 'ttft', 'tokens', 'rate-note', 'cache-rate', 'cache-detail-rate', 'cache-total', 'cache-coverage', 'cache-read', 'cache-miss', 'cache-write', 'cache-output', 'cache-write-row', 'task-own-row', 'task-subagents-row', 'task-subagents-label', 'cache-note', 'usage-today', 'usage-month', 'context-percent', 'context-ring', 'context-summary', 'context-tokens', 'context-model', 'context-fill', 'task-indicator', 'task-percent-badge', 'task-title-snippet', 'tp-gauge-percent', 'tp-ring-fill', 'tp-status-badge', 'tp-elapsed', 'tp-headline', 'tp-track-fill', 'tp-reinvoke-btn', 'tp-stalled-banner', 'tp-stalled-text', 'tp-objective', 'tp-source-tag', 'tp-steps-list', 'tp-task-log', 'group-trigger', 'group-menu', 'five-balance', 'five-fill', 'five-track', 'five-reset', 'five-countdown', 'five-note', 'week-balance', 'week-fill', 'week-track', 'week-reset', 'week-countdown', 'week-note', 'usage-today-label', 'usage-month-label', 'usage-open-label']) {
          this.append(new MiniElement('div', { id }));
        }
        return;
      }
      for (const m of html.matchAll(/id="([^"]+)"/g)) {
        this.append(new MiniElement('div', { id: m[1] }));
      }
    }
    get innerText() { return this.textContent; }
    setAttribute(k, v) {
      this.attrs.set(k, String(v));
      if (k === 'hidden') this.hidden = true;
    }
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
    hasAttribute(k) { return this.attrs.has(k) || (k === 'hidden' && this.hidden); }
    removeAttribute(k) {
      this.attrs.delete(k);
      if (k === 'hidden') this.hidden = false;
    }
    append(...nodes) {
      for (const n of nodes) {
        if (n && n._html) {
          if (n._html.includes('guide-heading') && !this.querySelector?.('.guide-heading')) {
            const h = new MiniElement('div', { class: 'guide-heading' });
            const st = new MiniElement('strong');
            const sp = new MiniElement('span');
            st.append(sp); h.append(st);
            const go = new MiniElement('div', { id: 'guide-open' });
            const hs = new MiniElement('span', { lang: 'zh-CN' });
            go.append(hs);
            const gc = new MiniElement('button', { id: 'guide-close' });
            const gsn = new MiniElement('div', { id: 'guide-save-note' });
            this.append(h, go, gc, gsn);
          }
          for (const m of n._html.matchAll(/id="([^"]+)"/g)) {
            if (!doc.getElementById(m[1])) {
              this.append(new MiniElement('div', { id: m[1] }));
            }
          }
          continue;
        }
        const node = typeof n === 'string' ? new MiniText(n) : n;
        node.remove?.();
        node.parentNode = this;
        node.parentElement = this.nodeType === 1 ? this : null;
        this.childNodes.push(node);
      }
    }
    prepend(...nodes) {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const node = typeof n === 'string' ? new MiniText(n) : n;
        node.remove?.();
        node.parentNode = this;
        node.parentElement = this.nodeType === 1 ? this : null;
        this.childNodes.unshift(node);
      }
    }
    before(...nodes) {
      const p = this.parentNode || this.parentElement;
      if (!p) return;
      const idx = p.childNodes.indexOf(this);
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        node.remove?.();
        node.parentNode = p;
        node.parentElement = p.nodeType === 1 ? p : null;
        p.childNodes.splice(idx + i, 0, node);
      }
    }
    after(...nodes) {
      const p = this.parentNode || this.parentElement;
      if (!p) return;
      const idx = p.childNodes.indexOf(this);
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        node.remove?.();
        node.parentNode = p;
        node.parentElement = p.nodeType === 1 ? p : null;
        p.childNodes.splice(idx + 1 + i, 0, node);
      }
    }
    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode || cur.parentElement;
      }
      return false;
    }
    matches(sel) { return matchesSelector(this, sel); }
    closest(sel) {
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (matchesSelector(cur, sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = root => {
        for (const c of root.children) {
          if (matchesSelector(c, sel, this)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    getClientRects() { return this.hidden ? [] : [this._rect]; }
    getBoundingClientRect() { return this._rect; }
    getContext() { return null; }
    addEventListener() {}
    removeEventListener() {}
    animate() { return { cancel() {} }; }
    attachShadow() {
      const sr = new ShadowRoot();
      this.shadowRoot = sr;
      return sr;
    }
  }

  class ShadowRoot extends MiniElement {
    constructor() {
      super('#shadow-root');
      this.nodeType = 11;
    }
    getElementById(id) {
      if (this.attrs.get('id') === id) return this;
      const walk = root => {
        for (const c of root.children) {
          if (c.id === id) return c;
          const found = walk(c);
          if (found) return found;
        }
        return null;
      };
      if (this._parsedElements) {
        for (const el of this._parsedElements) {
          if (el.id === id) return el;
        }
      }
      return walk(this);
    }
  }

  const docEl = new MiniElement('html');
  const body = new MiniElement('body');
  docEl.append(body);
  const doc = {
    readyState: 'complete',
    hidden: false,
    documentElement: docEl,
    body,
    activeElement: null,
    createElement: tag => new MiniElement(tag),
    createRange: () => ({
      createContextualFragment: html => ({ nodeType: 11, _html: String(html) }),
      selectNodeContents() {},
      getClientRects: () => [{ width: 40, height: 14 }],
    }),
    createTreeWalker(rootNode) {
      const queue = [];
      const collect = n => {
        for (const c of n.childNodes || []) {
          if (c.nodeType === 3) queue.push(c);
          else if (c.nodeType === 1) collect(c);
        }
      };
      collect(rootNode);
      let idx = 0;
      return { nextNode: () => (idx < queue.length ? queue[idx++] : null) };
    },
    getElementById: id => docEl.querySelector('#' + id),
    querySelector: sel => docEl.querySelector(sel),
    querySelectorAll: sel => docEl.querySelectorAll(sel),
    addEventListener() {},
    removeEventListener() {},
  };
  ShadowRoot.prototype.querySelector = MiniElement.prototype.querySelector;
  ShadowRoot.prototype.querySelectorAll = MiniElement.prototype.querySelectorAll;
  ShadowRoot.prototype.getElementById = ShadowRoot.prototype.getElementById;

  function makeComposer(withModelSelector = true, withSubagentBadge = false) {
    const box = new MiniElement('section', { 'data-testid': 'agent-input-box' });
    box._rect = { left: 20, top: 20, width: 600, height: 80, right: 620, bottom: 100 };
    const editor = new MiniElement('div', { role: 'textbox', contenteditable: 'true' });
    editor._rect = { left: 20, top: 20, width: 600, height: 40, right: 620, bottom: 60 };
    const actions = new MiniElement('div', { class: 'actions' });
    actions._rect = { left: 20, top: 64, width: 600, height: 32, right: 620, bottom: 96 };
    const left = new MiniElement('div', { class: 'left' });
    left._rect = { left: 20, top: 64, width: 120, height: 28, right: 140, bottom: 92 };
    if (withModelSelector) {
      const model = new MiniElement('button', { 'data-testid': 'model-selector-trigger' });
      model.textContent = 'Gemini 4';
      model._rect = { left: 20, top: 64, width: 100, height: 28, right: 120, bottom: 92 };
      left.append(model);
    } else if (withSubagentBadge) {
      const badge = new MiniElement('div', { class: 'badge' });
      badge._rect = { left: 20, top: 64, width: 110, height: 28, right: 130, bottom: 92 };
      const svg = new MiniElement('svg');
      svg._rect = { left: 22, top: 70, width: 14, height: 14, right: 36, bottom: 84 };
      const sp = new MiniElement('span');
      sp.textContent = 'Side Question';
      badge.append(svg, sp);
      left.append(badge);
    }
    const right = new MiniElement('div', { class: 'right' });
    right._rect = { left: 540, top: 64, width: 60, height: 28, right: 600, bottom: 92 };
    const send = new MiniElement('button', { 'data-testid': 'send-button' });
    send._rect = { left: 560, top: 64, width: 30, height: 28, right: 590, bottom: 92 };
    right.append(send);
    actions.append(left, right);
    box.append(editor, actions);
    return { box, editor };
  }

  function makeResponse() {
    const resp = new MiniElement('div', { 'data-testid': 'agent-response' });
    const sr = new MiniElement('h6');
    const stepList = new MiniElement('div', { 'data-step-list': 'true' });
    const stepBlock = new MiniElement('div', { class: 'relative' });
    stepBlock.textContent = 'Running step';
    stepList.append(stepBlock);
    resp.append(sr, stepList);
    return { resp, stepList };
  }

  return { doc, MiniElement, makeComposer, makeResponse, pathname };
}

async function withMockBrowser(setup, run) {
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    MutationObserver: globalThis.MutationObserver,
    ResizeObserver: globalThis.ResizeObserver,
    matchMedia: globalThis.matchMedia,
    HTMLElement: globalThis.HTMLElement,
    Node: globalThis.Node,
    NodeFilter: globalThis.NodeFilter,
    location: globalThis.location,
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  const timers = new Set();
  const origSetInterval = globalThis.setInterval;
  const origClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (fn, ms, ...args) => {
    const id = origSetInterval(fn, ms, ...args);
    id?.unref?.();
    timers.add(id);
    return id;
  };
  globalThis.clearInterval = id => {
    timers.delete(id);
    return origClearInterval(id);
  };
  const { doc, MiniElement, makeComposer, makeResponse, pathname } = setup();
  doc.elementFromPoint = () => null;
  const win = {
    location: { pathname, origin: 'https://127.0.0.1:53391' },
    __agPulseI18nFactory: createI18n,
    __agPulseThemeFactory: createTheme,
    innerWidth: 1440,
    innerHeight: 900,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.location = win.location;
  globalThis.innerWidth = 1440;
  globalThis.innerHeight = 900;
  globalThis.HTMLElement = MiniElement;
  globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
  globalThis.NodeFilter = { SHOW_ELEMENT: 1, SHOW_TEXT: 4 };
  globalThis.getComputedStyle = el => ({
    display: el.hidden ? 'none' : 'flex',
    visibility: 'visible',
    gap: '4px',
    flexWrap: 'nowrap',
    flexDirection: 'row',
    overflowX: 'visible',
    overflow: 'visible',
    colorScheme: 'dark',
    backgroundColor: 'rgb(23, 24, 26)',
    color: 'rgb(220, 220, 220)',
    getPropertyValue: () => '',
  });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  try {
    await run({ win, doc, MiniElement, makeComposer, makeResponse });
  } finally {
    try { win.__agPulseDispose?.(); } catch {}
    for (const id of timers) origClearInterval(id);
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  }
}

test('split /btw side-question-tab-conversation renders its own inline card while focus remains in main view', async () => {
  const mainId = '11111111-1111-1111-1111-111111111111';
  const sideId = '22222222-2222-2222-2222-222222222222';
  const calls = [];
  await withMockBrowser(() => createTestDom({ pathname: `/c/${mainId}` }), async ({ win, doc, MiniElement, makeComposer, makeResponse }) => {
    const mainView = new MiniElement('div', { 'data-testid': 'conversation-view', 'data-cascade-id': mainId });
    const mainResp = makeResponse();
    const mainComp = makeComposer(true);
    mainView.append(mainResp.resp, mainComp.box);

    const sideContent = new MiniElement('div', { 'data-testid': 'side-question-tab-content' });
    const sideConv = new MiniElement('div', { 'data-testid': 'side-question-tab-conversation', 'data-cascade-id': sideId });
    const sideResp = makeResponse();
    sideConv.append(sideResp.resp);
    const sideCompWrap = new MiniElement('div', { 'data-testid': 'side-question-tab-composer' });
    const sideComp = makeComposer(false, false);
    sideCompWrap.append(sideComp.box);
    sideContent.append(sideConv, sideCompWrap);

    doc.body.append(mainView, sideContent);
    doc.activeElement = mainComp.editor;

    win.agPulseHost = {
      getPreferences: async () => ({ language: 'zh-CN', languageGuideDismissed: true, usageGuideDismissed: true, revision: 1 }),
      setPreferences: async i => i,
      report: () => {},
      getMetrics: async input => {
        calls.push(input);
        return {
          connection: 'live',
          groups: [],
          speed: null,
          taskProgress: {
            status: 'completed',
            progressPercent: 100,
            turnStepIdx: 10,
            showInlineCard: false,
            steps: [],
          },
          auxTaskProgress: {
            [sideId]: {
              status: 'running',
              progressPercent: 50,
              turnStepIdx: 11,
              showInlineCard: true,
              steps: [
                { id: 1, title: '读取 task-186.log', status: 'completed', percent: 100 },
                { id: 2, title: '查看重导视频状态', status: 'running', percent: 50 },
              ],
            },
          },
        };
      },
    };

    installWidget();
    await new Promise(r => setTimeout(r, 30));

    assert.ok(calls.length >= 1);
    assert.equal(calls[0].conversationId, mainId);
    assert.deepEqual(calls[0].extraConversationIds, [sideId]);
    const mainCard = mainResp.stepList.querySelector('.ag-pulse-inline-chat-host');
    const sideCard = sideResp.stepList.querySelector('.ag-pulse-inline-chat-host');
    assert.equal(mainCard, null, 'Idle main view with showInlineCard=false must not show a card');
    assert.ok(sideCard, 'Side-question tab conversation must render its own Claude inline step card');
    const icList = sideCard.shadowRoot.getElementById('ic-list');
    assert.equal(icList.children.length, 2, 'Side-question card must contain both rendered steps');
    assert.match(icList.children[0].textContent, /读取 task-186\.log/);
  });
});

test('focused side-question-tab-composer resolves sibling sideId (not main route ID) even with hideModelSelector=true', async () => {
  const mainId = '11111111-1111-1111-1111-111111111111';
  const sideId = '22222222-2222-2222-2222-222222222222';
  const calls = [];
  await withMockBrowser(() => createTestDom({ pathname: `/c/${mainId}` }), async ({ win, doc, MiniElement, makeComposer, makeResponse }) => {
    const sideContent = new MiniElement('div', { 'data-testid': 'side-question-tab-content' });
    const sideConv = new MiniElement('div', { 'data-testid': 'side-question-tab-conversation', 'data-cascade-id': sideId });
    const sideResp = makeResponse();
    sideConv.append(sideResp.resp);
    const sideCompWrap = new MiniElement('div', { 'data-testid': 'side-question-tab-composer' });
    const sideComp = makeComposer(false, true);
    sideCompWrap.append(sideComp.box);
    sideContent.append(sideConv, sideCompWrap);

    doc.body.append(sideContent);
    doc.activeElement = sideComp.editor;

    win.agPulseHost = {
      getPreferences: async () => ({ language: 'zh-CN', languageGuideDismissed: true, usageGuideDismissed: true, revision: 1 }),
      setPreferences: async i => i,
      report: () => {},
      getMetrics: async input => {
        calls.push(input);
        return {
          connection: 'live',
          groups: [],
          speed: null,
          taskProgress: {
            status: 'completed',
            progressPercent: 100,
            turnStepIdx: 194,
            showInlineCard: true,
            steps: [
              { id: 1, title: '第一步', status: 'completed', percent: 100 },
              { id: 2, title: '第二步', status: 'completed', percent: 100 },
            ],
          },
        };
      },
    };

    installWidget();
    await new Promise(r => setTimeout(r, 30));

    assert.ok(calls.length >= 1);
    assert.equal(calls[0].conversationId, sideId, 'Must bind to sibling side-question conversation ID rather than main route ID');
    const sideCard = sideResp.stepList.querySelector('.ag-pulse-inline-chat-host');
    assert.ok(sideCard, 'Focused side-question tab must render inline step card');
  });
});

test('full-view /btw conversation without model selector or badge still renders inline step card', async () => {
  const sideId = '33333333-3333-3333-3333-333333333333';
  const calls = [];
  await withMockBrowser(() => createTestDom({ pathname: `/c/${sideId}` }), async ({ win, doc, MiniElement, makeComposer, makeResponse }) => {
    const view = new MiniElement('div', { 'data-testid': 'conversation-view', 'data-cascade-id': sideId });
    const resp = makeResponse();
    // hideModelSelector=true and no subagent badge -> findComposer returns null
    const comp = makeComposer(false, false);
    view.append(resp.resp, comp.box);
    doc.body.append(view);

    win.agPulseHost = {
      getPreferences: async () => ({ language: 'zh-CN', languageGuideDismissed: true, usageGuideDismissed: true, revision: 1 }),
      setPreferences: async i => i,
      report: () => {},
      getMetrics: async input => {
        calls.push(input);
        return {
          connection: 'live',
          groups: [],
          speed: null,
          taskProgress: {
            status: 'running',
            progressPercent: 50,
            turnStepIdx: 4,
            showInlineCard: true,
            steps: [
              { id: 1, title: '读取日志', status: 'completed', percent: 100 },
              { id: 2, title: '整理输出', status: 'running', percent: 50 },
            ],
          },
        };
      },
    };

    installWidget();
    await new Promise(r => setTimeout(r, 30));

    assert.ok(calls.length >= 1, 'Card-only polling fallback must request metrics for visible conversation-view');
    assert.equal(calls[0].conversationId, sideId);
    assert.ok(resp.stepList.querySelector('.ag-pulse-inline-chat-host'), 'Inline card must still appear in full-view /btw even when composer has no model selector');
  });
});

test('genuine subagent-tab-conversation continues to isolate and suppress inline chat card', async () => {
  const mainId = '11111111-1111-1111-1111-111111111111';
  const subId = '44444444-4444-4444-4444-444444444444';
  const calls = [];
  await withMockBrowser(() => createTestDom({ pathname: `/c/${mainId}` }), async ({ win, doc, MiniElement, makeComposer, makeResponse }) => {
    const mainView = new MiniElement('div', { 'data-testid': 'conversation-view', 'data-cascade-id': mainId });
    const mainIndicator = new MiniElement('span');
    mainIndicator.textContent = '2 subagents running';
    mainView.append(mainIndicator);
    const aux = new MiniElement('div', { 'data-aux-pane-open': 'true' });
    const subConv = new MiniElement('div', { 'data-testid': 'subagent-tab-conversation', 'data-cascade-id': subId });
    const subResp = makeResponse();
    subConv.append(subResp.resp);
    const subComp = makeComposer(false, true);
    aux.append(subConv, subComp.box);
    doc.body.append(mainView, aux);
    doc.activeElement = subComp.editor;

    win.agPulseHost = {
      getPreferences: async () => ({ language: 'zh-CN', languageGuideDismissed: true, usageGuideDismissed: true, revision: 1 }),
      setPreferences: async i => i,
      report: () => {},
      getMetrics: async input => {
        calls.push(input);
        return {
          connection: 'live',
          groups: [],
          speed: null,
          taskProgress: {
            status: 'running',
            progressPercent: 50,
            turnStepIdx: 2,
            showInlineCard: true,
            steps: [
              { id: 1, title: 'Step 1', status: 'completed', percent: 100 },
              { id: 2, title: 'Step 2', status: 'running', percent: 50 },
            ],
          },
        };
      },
    };

    installWidget();
    await new Promise(r => setTimeout(r, 30));

    assert.ok(calls.length >= 1);
    assert.equal(calls[0].conversationId, subId);
    assert.equal(calls[0].domRunningSubagents, undefined, 'Focused subagent sidebar must not count main-view subagent indicators');
    assert.equal(subResp.stepList.querySelector('.ag-pulse-inline-chat-host'), null, 'Genuine subagent sidebar tab must not render inline chat card');
  });
});

test('missing auxTaskProgress clears stale inline card in split /btw pane', async () => {
  const mainId = '11111111-1111-1111-1111-111111111111';
  const sideId = '22222222-2222-2222-2222-222222222222';
  let omitAux = false;
  await withMockBrowser(() => createTestDom({ pathname: `/c/${mainId}` }), async ({ win, doc, MiniElement, makeComposer, makeResponse }) => {
    const mainView = new MiniElement('div', { 'data-testid': 'conversation-view', 'data-cascade-id': mainId });
    const mainComp = makeComposer(true);
    mainView.append(mainComp.box);

    const sideContent = new MiniElement('div', { 'data-testid': 'side-question-tab-content' });
    const sideConv = new MiniElement('div', { 'data-testid': 'side-question-tab-conversation', 'data-cascade-id': sideId });
    const sideResp = makeResponse();
    sideConv.append(sideResp.resp);
    const sideCompWrap = new MiniElement('div', { 'data-testid': 'side-question-tab-composer' });
    sideCompWrap.append(makeComposer(false, false).box);
    sideContent.append(sideConv, sideCompWrap);

    doc.body.append(mainView, sideContent);
    doc.activeElement = mainComp.editor;

    win.agPulseHost = {
      getPreferences: async () => ({ language: 'zh-CN', languageGuideDismissed: true, usageGuideDismissed: true, revision: 1 }),
      setPreferences: async i => i,
      report: () => {},
      getMetrics: async () => ({
        connection: 'live',
        groups: [],
        speed: null,
        taskProgress: { status: 'idle', progressPercent: 0, turnStepIdx: 1, showInlineCard: false, steps: [] },
        ...(omitAux ? {} : {
          auxTaskProgress: {
            [sideId]: {
              status: 'running',
              progressPercent: 50,
              turnStepIdx: 2,
              showInlineCard: true,
              steps: [
                { id: 1, title: '第一步', status: 'completed', percent: 100 },
                { id: 2, title: '第二步', status: 'running', percent: 50 },
              ],
            },
          },
        }),
      }),
    };

    installWidget();
    await new Promise(r => setTimeout(r, 30));
    assert.ok(sideResp.stepList.querySelector('.ag-pulse-inline-chat-host'), 'Initial aux card must render');

    omitAux = true;
    await new Promise(r => setTimeout(r, 1300));
    assert.equal(Boolean(sideResp.stepList.querySelector('.ag-pulse-inline-chat-host')), false, 'Stale aux card must be cleared when auxTaskProgress is absent');
  });
});
