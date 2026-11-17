import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const createHostTranslator = require('../../../compat/host-i18n.cjs');

function makeMiniDom() {
  class FakeNode {
    constructor(nodeType) {
      this.nodeType = nodeType;
      this.parentElement = null;
      this.parentNode = null;
      this.childNodes = [];
      this.isConnected = true;
    }
    append(...children) {
      for (const c of children) {
        c.parentNode = this;
        c.parentElement = this.nodeType === 1 ? this : null;
        this.childNodes.push(c);
      }
    }
  }
  class FakeText extends FakeNode {
    constructor(value) { super(3); this.nodeValue = value; }
  }
  class FakeElement extends FakeNode {
    constructor(tagName, attrs = {}) {
      super(1);
      this.tagName = tagName.toUpperCase();
      this.attrs = new Map(Object.entries(attrs));
    }
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    matches(selector) {
      return selector.split(',').some(sel => {
        sel = sel.trim();
        if (!sel) return false;
        if (sel.includes(' ')) {
          const parts = sel.split(/\s+/);
          const last = parts[parts.length - 1];
          const anc = parts.slice(0, -1).join(' ');
          return this.matches(last) && Boolean(this.parentElement?.closest(anc));
        }
        if (sel.startsWith('#')) return this.getAttribute('id') === sel.slice(1);
        if (sel.startsWith('.')) return (this.getAttribute('class') || '').split(/\s+/).includes(sel.slice(1));
        const attrMatch = sel.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
        if (attrMatch) {
          const v = this.getAttribute(attrMatch[1]);
          return attrMatch[2] !== undefined ? v === attrMatch[2] : v !== null;
        }
        return this.tagName === sel.toUpperCase();
      });
    }
    closest(selector) {
      for (let cur = this; cur && cur.nodeType === 1; cur = cur.parentElement) {
        if (cur.matches(selector)) return cur;
      }
      return null;
    }
  }

  const body = new FakeElement('body');
  const document = {
    body,
    createTreeWalker(root, whatToShow) {
      const flat = [];
      const walk = node => {
        for (const c of node.childNodes) {
          if ((c.nodeType === 1 && (whatToShow & 1)) || (c.nodeType === 3 && (whatToShow & 4))) flat.push(c);
          if (c.nodeType === 1) walk(c);
        }
      };
      walk(root);
      let idx = 0;
      return { nextNode: () => (idx < flat.length ? flat[idx++] : null) };
    }
  };
  class FakeMutationObserver {
    constructor(cb) { this.cb = cb; }
    observe() {}
    disconnect() {}
  }
  return { FakeElement, FakeText, document, FakeMutationObserver };
}

test('host-i18n translates host UI chrome, preserves protected regions, supports zh-TW, and restores English cleanly', async () => {
  const { FakeElement, FakeText, document, FakeMutationObserver } = makeMiniDom();
  const prevDoc = globalThis.document;
  const prevNodeFilter = globalThis.NodeFilter;
  const prevObserver = globalThis.MutationObserver;
  const prevRaf = globalThis.requestAnimationFrame;

  globalThis.document = document;
  globalThis.NodeFilter = { SHOW_ELEMENT: 1, SHOW_TEXT: 4 };
  globalThis.MutationObserver = FakeMutationObserver;
  globalThis.requestAnimationFrame = fn => { fn(); return 1; };

  try {
    const sidebarBtn = new FakeElement('button', { 'aria-label': 'Toggle Sidebar' });
    const pinnedText = new FakeText('Pinned Conversations');
    sidebarBtn.append(pinnedText);

    const worked = new FakeElement('span');
    const workedText = new FakeText('Worked for 58s');
    worked.append(workedText);

    const taskFooter = new FakeElement('span');
    const taskText = new FakeText('1 task running');
    taskFooter.append(taskText);

    const composerPh = new FakeElement('div');
    const phText = new FakeText('Ask anything, @ to mention, / for actions');
    composerPh.append(phText);

    const modelBtn = new FakeElement('button', { 'data-testid': 'model-selector-trigger', 'aria-label': 'Select model, current: Gemini 4 Hydrogen High' });
    const modelText = new FakeText('Gemini 4 Hydrogen');
    modelBtn.append(modelText);

    const codeBlock = new FakeElement('pre');
    const codeText = new FakeText('New Conversation');
    codeBlock.append(codeText);

    const response = new FakeElement('div', { 'data-testid': 'agent-response' });
    const prose = new FakeElement('div', { class: 'prose' });
    const proseText = new FakeText('Settings');
    prose.append(proseText);
    response.append(prose);

    const pulseBar = new FakeElement('div', { id: 'ag-pulse-status-bar' });
    const pulseText = new FakeText('Working');
    pulseBar.append(pulseText);

    document.body.append(sidebarBtn, worked, taskFooter, composerPh, modelBtn, codeBlock, response, pulseBar);

    const tr = createHostTranslator({ enabled: true, language: 'zh-CN' });
    assert.equal(sidebarBtn.getAttribute('aria-label'), '切换侧边栏');
    assert.equal(pinnedText.nodeValue, '置顶对话');
    assert.equal(workedText.nodeValue, '已执行 58 秒');
    assert.equal(taskText.nodeValue, '1 个任务运行中');
    assert.equal(phText.nodeValue, '想问什么都可以，@ 引用，/ 执行动作');
    assert.equal(modelBtn.getAttribute('aria-label'), '选择模型，当前：Gemini 4 Hydrogen High');
    assert.equal(modelText.nodeValue, 'Gemini 4 Hydrogen');
    assert.equal(codeText.nodeValue, 'New Conversation', 'Code block must never be translated');
    assert.equal(proseText.nodeValue, 'Settings', 'Assistant markdown prose must never be translated');
    assert.equal(pulseText.nodeValue, 'Working', 'Plugin own widget must be skipped');

    tr.setConfig({ enabled: true, language: 'zh-TW' });
    assert.equal(sidebarBtn.getAttribute('aria-label'), '切換側邊欄');
    assert.equal(pinnedText.nodeValue, '置頂對話');
    assert.equal(workedText.nodeValue, '已執行 58 秒');

    tr.setConfig({ enabled: false, language: 'en' });
    assert.equal(sidebarBtn.getAttribute('aria-label'), 'Toggle Sidebar');
    assert.equal(pinnedText.nodeValue, 'Pinned Conversations');
    assert.equal(workedText.nodeValue, 'Worked for 58s');
    assert.equal(taskText.nodeValue, '1 task running');

    tr.setConfig({ enabled: true, language: 'zh-CN' });
    assert.equal(pinnedText.nodeValue, '置顶对话');
    tr.dispose();
    assert.equal(pinnedText.nodeValue, 'Pinned Conversations', 'Dispose must restore original English text');
  } finally {
    globalThis.document = prevDoc;
    globalThis.NodeFilter = prevNodeFilter;
    globalThis.MutationObserver = prevObserver;
    globalThis.requestAnimationFrame = prevRaf;
  }
});
