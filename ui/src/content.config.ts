import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const definitions = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/definitions' }),
	schema: z.object({
		tooltip: z.string().optional(),
	}),
});

export const collections = { definitions };
