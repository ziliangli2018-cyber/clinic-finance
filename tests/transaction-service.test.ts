import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../src/services/supabase', () => ({ supabase: { rpc } }));

import { saveCategories, saveCategory } from '../src/services/finance';

beforeEach(() => vi.resetAllMocks());

describe('atomic transaction category updates', () => {
  it('saves unique IDs with one RPC and returns the confirmed count', async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    await expect(saveCategories(['first', 'second', 'first'], 'category')).resolves.toBe(2);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('set_transaction_categories', {
      transaction_ids: ['first', 'second'],
      category_id: 'category',
    });
  });

  it('rejects an empty or oversized selection before making a request', async () => {
    await expect(saveCategories([], 'category')).rejects.toThrow('Select between');
    await expect(saveCategories(['first'], '')).rejects.toThrow('Select between');
    await expect(saveCategories([''], 'category')).rejects.toThrow('Select between');
    await expect(
      saveCategories(
        Array.from({ length: 1001 }, (_, index) => String(index)),
        'category',
      ),
    ).rejects.toThrow('Select between');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not report a failed or incomplete save as success', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('Unauthorised transaction') });
    await expect(saveCategories(['first', 'second'], 'category')).rejects.toThrow('Unauthorised');
    for (const data of [1, '2', null, 2.5]) {
      rpc.mockResolvedValue({ data, error: null });
      await expect(saveCategories(['first', 'second'], 'category')).rejects.toThrow(
        'could not be confirmed',
      );
    }
  });

  it('preserves the original single-transaction action', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await saveCategory('first', 'category');
    expect(rpc).toHaveBeenCalledWith('set_transaction_category', {
      transaction_id: 'first',
      category_id: 'category',
    });
  });
});
