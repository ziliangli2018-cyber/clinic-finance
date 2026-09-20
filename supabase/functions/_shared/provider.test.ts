import { assertMockAllowed, bankProvider, scopedUuid } from './provider.ts';

Deno.test('mock integration requires all explicit server gates', () => {
  for (const [env, allow, demo] of [
    ['production', 'true', true],
    [undefined, 'true', true],
    ['demo', undefined, true],
    ['demo', 'false', true],
    ['development', 'true', false],
    ['staging', 'true', true],
  ] as const) {
    let rejected = false;
    try {
      assertMockAllowed(env, allow, demo);
    } catch {
      rejected = true;
    }
    if (!rejected)
      throw new Error(`Mock gate accepted invalid combination ${env}/${allow}/${demo}`);
  }
  assertMockAllowed('development', 'true', true);
  assertMockAllowed('demo', 'true', true);
});

Deno.test('stable identifiers are deterministic and isolated by tenant', async () => {
  const id = 'd083fdf8-4474-400b-9133-1a866391237c';
  const first = await scopedUuid('tenant-a', id);
  if (first !== (await scopedUuid('tenant-a', id))) throw new Error('Unstable identifier');
  if (first === (await scopedUuid('tenant-b', id))) throw new Error('Tenant identifier collision');
  if (!/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(first))
    throw new Error('Invalid UUID');
});

Deno.test('live provider remains explicitly unimplemented', () => {
  let rejected = false;
  try {
    bankProvider('basiq', 'production', 'false', false);
  } catch (error) {
    rejected = error instanceof Error && error.message.includes('not available');
  }
  if (!rejected) throw new Error('Live provider must not claim implementation');
});
