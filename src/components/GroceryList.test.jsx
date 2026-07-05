import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import GroceryList from './GroceryList';
import { getList, updateQuantity } from '../services/groceryService';

// Silences "not configured to support act(...)" console noise; jsdom + React 19
// need this flag set explicitly since there's no test-renderer-provided setup here.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../services/groceryService', () => ({
  getList: jest.fn(),
  addMealItems: jest.fn(),
  addStapleItems: jest.fn(),
  addManualItem: jest.fn(),
  toggleItem: jest.fn(),
  updateQuantity: jest.fn(),
  clearList: jest.fn(),
}));

jest.mock('../services/staplesService', () => ({
  getAllStaples: jest.fn(async () => []),
}));

const baseList = {
  eggs: { displayText: 'Eggs', count: 1, meals: [], checked: false },
  chicken: { displayText: 'Chicken', count: 3, meals: ['Tacos'], checked: false },
  rice: { displayText: 'Rice', count: 2, meals: ['Tacos'], checked: true },
};

function getExportPayload(container) {
  const script = container.ownerDocument.querySelector('#grocery-export-data');
  expect(script).not.toBeNull();
  return JSON.parse(script.textContent);
}

describe('GroceryList export payload', () => {
  let container;

  beforeEach(() => {
    jest.clearAllMocks();
    getList.mockResolvedValue(JSON.parse(JSON.stringify(baseList)));
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
  });

  async function renderList() {
    const root = createRoot(container);
    await act(async () => {
      root.render(<GroceryList weekMeals={[]} />);
    });
    return root;
  }

  it('renders a parseable hidden JSON payload with unchecked items only by default', async () => {
    await renderList();

    const payload = getExportPayload(container);
    expect(typeof payload.exportedAt).toBe('string');
    expect(new Date(payload.exportedAt).toString()).not.toBe('Invalid Date');
    expect(payload.items).toEqual(
      expect.arrayContaining([
        { name: 'Eggs', quantity: 1 },
        { name: 'Chicken', quantity: 3 },
      ])
    );
    expect(payload.items).toHaveLength(2); // rice is checked, excluded by default
  });

  it('includes all items once the export toggle is switched on', async () => {
    await renderList();

    const switchInput = container.querySelector('.MuiSwitch-input');
    expect(switchInput).not.toBeNull();

    await act(async () => {
      switchInput.click();
    });

    const payload = getExportPayload(container);
    expect(payload.items).toHaveLength(3);
    expect(payload.items).toEqual(
      expect.arrayContaining([{ name: 'Rice', quantity: 2 }])
    );
  });

  it('escapes "<" so the JSON survives even if a name contains "</script>"', async () => {
    getList.mockResolvedValue({
      sneaky: { displayText: '</script><b>x</b>', count: 1, meals: [], checked: false },
    });

    await renderList();

    const script = container.querySelector('#grocery-export-data');
    // The raw script tag content must never contain a literal "</script>"
    expect(script.textContent).not.toContain('</script>');
    const payload = JSON.parse(script.textContent);
    expect(payload.items[0].name).toBe('</script><b>x</b>');
  });

  it('disables the decrement stepper button at a count of 1', async () => {
    getList.mockResolvedValue({
      eggs: { displayText: 'Eggs', count: 1, meals: [], checked: false },
    });

    await renderList();

    const decrementButton = container.querySelector(
      'button[aria-label="decrease quantity of Eggs"]'
    );
    expect(decrementButton).not.toBeNull();
    expect(decrementButton.disabled).toBe(true);

    await act(async () => {
      decrementButton.click();
    });
    expect(updateQuantity).not.toHaveBeenCalled();
  });

  it('calls updateQuantity when the increment stepper button is clicked', async () => {
    getList.mockResolvedValue({
      eggs: { displayText: 'Eggs', count: 1, meals: [], checked: false },
    });

    await renderList();

    const incrementButton = container.querySelector(
      'button[aria-label="increase quantity of Eggs"]'
    );

    await act(async () => {
      incrementButton.click();
    });

    expect(updateQuantity).toHaveBeenCalledWith('eggs', 2);
  });
});
