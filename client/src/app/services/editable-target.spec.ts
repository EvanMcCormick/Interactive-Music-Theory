import { isEditableTarget } from './editable-target';

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

  it('is false for a button, the document body, and no target', () => {
    expect(isEditableTarget(element('button'))).toBeFalse();
    expect(isEditableTarget(document.body)).toBeFalse();
    expect(isEditableTarget(null)).toBeFalse();
  });
});
