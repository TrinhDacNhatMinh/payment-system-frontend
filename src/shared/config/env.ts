import { parseEnvironment } from './env-schema';

export const environment = parseEnvironment(import.meta.env);
