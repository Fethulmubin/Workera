export const generateText = jest.fn();
export const streamText = jest.fn();
export const Output = {
  object: jest.fn((options) => ({ name: 'object', ...options })),
};
