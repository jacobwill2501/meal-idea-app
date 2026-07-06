import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import IngredientRowsEditor from './IngredientRowsEditor';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('IngredientRowsEditor', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
  });

  async function renderEditor(rows, onChange) {
    const root = createRoot(container);
    await act(async () => {
      root.render(<IngredientRowsEditor label="Protein Option" rows={rows} onChange={onChange} />);
    });
    return root;
  }

  it('calls onChange with a new blank row when "Add ingredient" is clicked', async () => {
    const onChange = jest.fn();
    await renderEditor([{ name: 'chicken', qty: 1 }], onChange);

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Add ingredient'
    );
    await act(async () => {
      addButton.click();
    });

    expect(onChange).toHaveBeenCalledWith([
      { name: 'chicken', qty: 1 },
      { name: '', qty: 1 },
    ]);
  });

  it('calls onChange with the row removed when its remove button is clicked', async () => {
    const onChange = jest.fn();
    await renderEditor(
      [{ name: 'chicken', qty: 1 }, { name: 'rice', qty: 2 }],
      onChange
    );

    const removeButton = container.querySelector('button[aria-label="remove row 1"]');
    await act(async () => {
      removeButton.click();
    });

    expect(onChange).toHaveBeenCalledWith([{ name: 'rice', qty: 2 }]);
  });

  it('increments a row quantity when its + button is clicked', async () => {
    const onChange = jest.fn();
    await renderEditor([{ name: 'chicken', qty: 1 }], onChange);

    const incrementButton = container.querySelector(
      'button[aria-label="increase quantity of row 1"]'
    );
    await act(async () => {
      incrementButton.click();
    });

    expect(onChange).toHaveBeenCalledWith([{ name: 'chicken', qty: 2 }]);
  });

  it('disables the decrement button at qty 1 and does not call onChange', async () => {
    const onChange = jest.fn();
    await renderEditor([{ name: 'chicken', qty: 1 }], onChange);

    const decrementButton = container.querySelector(
      'button[aria-label="decrease quantity of row 1"]'
    );
    expect(decrementButton.disabled).toBe(true);

    await act(async () => {
      decrementButton.click();
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
