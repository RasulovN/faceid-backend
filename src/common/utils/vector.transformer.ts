import { ValueTransformer } from 'typeorm';

/**
 * pgvector `vector(512)` ustuni uchun transformer:
 * DB'da '[0.1,0.2,...]' satr — kodda number[].
 */
export const vectorTransformer: ValueTransformer = {
  to: (value?: number[] | null): string | null =>
    Array.isArray(value) ? `[${value.join(',')}]` : (value ?? null),
  from: (value?: string | null): number[] | null =>
    typeof value === 'string' ? (JSON.parse(value) as number[]) : (value ?? null),
};
