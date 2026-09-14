import { isEditableTarget, pressesFocusedControl } from './editable-target';

describe('isEditableTarget', () => {
  const attached: HTMLElement[] = [];

  /** An element in the document, since `isContentEditable` reads the rendered state. */
  function element<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
    const created = document.createElement(tag);
    document.body.appendChild(created);
    attached.push(created);
    return created;
  }

  afterEach(() => attached.splice(0).forEach(node => node.remove()));

  it('is true for an input, a textarea and a select', () => {
    expect(isEditableTarget(element('input'))).toBeTrue();
    expect(isEditableTarget(element('textarea'))).toBeTrue();
    expect(isEditableTarget(element('select'))).toBeTrue();
  });

  it('is true inside a contentEditable element', () => {
    const editor = element('div');
    editor.contentEditable = 'true';
    const inner = document.createElement('span');
    editor.appendChild(inner);

    expect(isEditableTarget(editor)).toBeTrue();
    expect(isEditableTarget(inner)).toBeTrue();
  });

  it('is true for every input that is typed into, and for one with no type, which is text', () => {
    for (const type of ['text', 'search', 'url', 'email', 'tel', 'password', 'number']) {
      const input = element('input');
      input.type = type;
      expect(isEditableTarget(input)).withContext(type).toBeTrue();
    }
    expect(isEditableTarget(element('input'))).toBeTrue();
  });

  it('is false for an input nothing is typed into - a checkbox, a radio, a button, a file', () => {
    // A focused checkbox keeps focus after a click; a shortcut pressed next must still reach the page.
    for (const type of ['checkbox', 'radio', 'button', 'file', 'range', 'color']) {
      const input = element('input');
      input.type = type;
      expect(isEditableTarget(input)).withContext(type).toBeFalse();
    }
  });

  it('is false for a button, the document body, and no target', () => {
    expect(isEditableTarget(element('button'))).toBeFalse();
    expect(isEditableTarget(document.body)).toBeFalse();
    expect(isEditableTarget(null)).toBeFalse();
  });
});

describe('pressesFocusedControl', () => {
  const attached: HTMLElement[] = [];

  function element<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
    const created = document.createElement(tag);
    document.body.appendChild(created);
    attached.push(created);
    return created;
  }

  afterEach(() => attached.splice(0).forEach(node => node.remove()));

  const press = (key: string, target: EventTarget, modifiers: Partial<KeyboardEvent> = {}) => ({
    key, target, ctrlKey: false, altKey: false, metaKey: false, ...modifiers
  });

  it('is true for Space and Enter, Shift or not, on a button, a link, a checkbox and a role="button"', () => {
    const link = element('a');
    link.href = '#';
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    const custom = element('div');
    custom.setAttribute('role', 'button');

    for (const target of [element('button'), link, checkbox, custom]) {
      expect(pressesFocusedControl(press(' ', target))).withContext(target.tagName).toBeTrue();
      expect(pressesFocusedControl(press('Enter', target, { shiftKey: true }))).withContext(target.tagName).toBeTrue();
    }
  });

  it('is false with Ctrl, Alt or Cmd, for any other key, and off a control', () => {
    const button = element('button');

    expect(pressesFocusedControl(press(' ', button, { ctrlKey: true }))).toBeFalse();
    expect(pressesFocusedControl(press('Enter', button, { altKey: true }))).toBeFalse();
    expect(pressesFocusedControl(press('Enter', button, { metaKey: true }))).toBeFalse();
    expect(pressesFocusedControl(press('q', button))).toBeFalse();
    expect(pressesFocusedControl(press(' ', document.body))).toBeFalse();
    expect(pressesFocusedControl(press(' ', element('a')))).toBeFalse();
  });
});
