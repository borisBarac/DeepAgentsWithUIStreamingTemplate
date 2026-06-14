export type CreateGreetingOptions = {
  name?: string;
};

export function createGreeting(options: CreateGreetingOptions = {}): string {
  const name = options.name?.trim() || "world";

  return `Hello, ${name}!`;
}
