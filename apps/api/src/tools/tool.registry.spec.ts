import { BadRequestException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { ToolRegistry } from './tool.registry';

describe('ToolRegistry', () => {
  const createRegistry = () => new ToolRegistry();

  const calculatorTool = {
    name: 'calculator',
    description: 'Performs a basic calculation.',
    inputSchema: z.object({
      a: z.number(),
      b: z.number(),
    }),
    execute: async (
      input: { a: number; b: number },
      _context: { organizationId: string },
    ) => input.a + input.b,
  };

  it('registers and retrieves a tool', () => {
    const registry = createRegistry();

    registry.register(calculatorTool);

    expect(registry.has('calculator')).toBe(true);
    expect(registry.get('calculator')).toBe(calculatorTool);
    expect(registry.list()).toHaveLength(1);
  });

  it('rejects duplicate tool names', () => {
    const registry = createRegistry();

    registry.register(calculatorTool);

    expect(() => registry.register(calculatorTool)).toThrow(
      'Tool "calculator" is already registered',
    );
  });

  it('throws when a tool does not exist', () => {
    const registry = createRegistry();

    expect(() => registry.get('missing')).toThrow(NotFoundException);
  });

  it('validates input before execution', async () => {
    const registry = createRegistry();
    registry.register(calculatorTool);

    await expect(
      registry.execute(
        'calculator',
        { a: 'wrong', b: 2 },
        { organizationId: 'org-1' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('executes a registered tool with validated input', async () => {
    const registry = createRegistry();
    registry.register(calculatorTool);

    await expect(
      registry.execute(
        'calculator',
        { a: 2, b: 3 },
        { organizationId: 'org-1' },
      ),
    ).resolves.toBe(5);
  });
});
