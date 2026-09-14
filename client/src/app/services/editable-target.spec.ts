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

  /**
   * `element`, focused from the keyboard: it matches `:focus-visible`. Faked, since a headless browser decides that
   * from how the focus arrived, which a script's `focus()` does not reliably set.
   */
  function keyboardFocused<K extends keyof HTMLElementTagNameMap>(tag: K, setUp: (created: HTMLElementTagNameMap[K]) => void = () => undefined): HTMLElementTagNameMap[K] {
    const created = element(tag);
    setUp(created);
    spyOn(created as HTMLElement, 'matches').and.callFake((selector: string): boolean => selector === ':focus-visible');
    return created;
  }

  /** Which of Space and Enter `pressesFocusedControl` leaves to `target`, Shift held for Enter. */
  const keysPressing = (target: EventTarget): string[] =>
    [press(' ', target), press('Enter', target, { shiftKey: true })].filter(pressesFocusedControl).map(event => event.key);

  it('leaves both Space and Enter to a button, a button input, a summary and a role="button"', () => {
    const targets = [
      keyboardFocused('button'),
      keyboardFocused('input', input => (input.type = 'submit')),
      keyboardFocused('summary'),
      keyboardFocused('div', div => div.setAttribute('role', 'button'))
    ];

    for (const target of targets) expect(keysPressing(target)).withContext(target.outerHTML).toEqual([' ', 'Enter']);
  });

  it('leaves only Enter to a link and a role="link", which the browser does not press with Space', () => {
    const targets = [keyboardFocused('a', link => (link.href = '#')), keyboardFocused('span', span => span.setAttribute('role', 'link'))];

    for (const target of targets) expect(keysPressing(target)).withContext(target.outerHTML).toEqual(['Enter']);
  });

  it('leaves only Space to a checkbox, a radio and a role of checkbox, radio or switch, which the browser does not press with Enter', () => {
    const targets = [
      keyboardFocused('input', input => (input.type = 'checkbox')),
      keyboardFocused('input', input => (input.type = 'radio')),
      ...['checkbox', 'radio', 'switch'].map(role => keyboardFocused('div', div => div.setAttribute('role', role)))
    ];

    for (const target of targets) expect(keysPressing(target)).withContext(target.outerHTML).toEqual([' ']);
  });

  it('leaves neither to a button the mouse left the focus on, which does not match :focus-visible', () => {
    const clicked = element('button');
    spyOn(clicked, 'matches').and.returnValue(false);

    expect(keysPressing(clicked)).toEqual([]);
  });

  it('is false with Ctrl, Alt or Cmd, for any other key, and off a control', () => {
    const button = keyboardFocused('button');

    expect(pressesFocusedControl(press(' ', button, { ctrlKey: true }))).toBeFalse();
    expect(pressesFocusedControl(press('Enter', button, { altKey: true }))).toBeFalse();
    expect(pressesFocusedControl(press('Enter', button, { metaKey: true }))).toBeFalse();
    expect(pressesFocusedControl(press('q', button))).toBeFalse();
    expect(pressesFocusedControl(press(' ', document.body))).toBeFalse();
    expect(keysPressing(keyboardFocused('a'))).withContext('a link with no href').toEqual([]);
    expect(keysPressing(keyboardFocused('div', div => div.setAttribute('role', 'tab')))).toEqual([]);
  });
});
