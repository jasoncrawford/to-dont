import { existsSync, copyFileSync, unlinkSync } from 'fs';
import { resolve } from 'path';

export default function globalTeardown() {
  const dotenvPath = resolve(__dirname, '..', '.env');
  const dotenvBackup = resolve(__dirname, '..', '.env.pre-test');

  if (existsSync(dotenvBackup)) {
    copyFileSync(dotenvBackup, dotenvPath);
    unlinkSync(dotenvBackup);
  }
}
