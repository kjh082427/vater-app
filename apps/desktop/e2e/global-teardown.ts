import { readFileSync } from 'node:fs';
import { STACK_FILE, stopStack, type StackInfo } from './stack';

export default async function globalTeardown() {
  const info = JSON.parse(readFileSync(STACK_FILE, 'utf8')) as StackInfo;
  await stopStack(info);
}
