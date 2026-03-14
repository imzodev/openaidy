export interface RuntimeProvider {
  id: string;
  run(input: { prompt: string }): Promise<{ output: string }>;
}
