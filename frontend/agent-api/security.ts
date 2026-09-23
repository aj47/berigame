import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ApiError, digest, secret, type Invite } from './portable';
export { ApiError, digest, secret, Budget, AddressLimits, type Invite } from './portable';

/** A separate file per invite allows atomic, durable single-use redemption. */
export class InviteStore {
  constructor(private directory: string) {}
  private async prepare() {
    await mkdir(join(this.directory, 'invites'), { recursive: true, mode: 0o700 });
    await mkdir(join(this.directory, 'spent'), { recursive: true, mode: 0o700 });
  }
  async issue(invite: Invite): Promise<string> {
    await this.prepare();
    const code = secret('bgi_');
    await writeFile(join(this.directory, 'invites', digest(code) + '.json'), JSON.stringify(invite), { mode: 0o600, flag: 'wx' });
    return code;
  }
  async consume(code: string, now = Date.now()): Promise<Invite> {
    const invalid = () => new ApiError(401, 'invalid_invite', 'This invite is invalid, expired, or already used.');
    if (!/^bgi_[A-Za-z0-9_-]{43}$/.test(code)) throw invalid();
    await this.prepare();
    const file = digest(code) + '.json';
    const used = join(this.directory, 'spent', file);
    try {
      // Claim before any await that creates a game connection. A second caller,
      // including another process, cannot redeem the same source file.
      await rename(join(this.directory, 'invites', file), used);
    } catch (error: any) {
      if (error.code === 'ENOENT') throw invalid();
      throw new ApiError(503, 'invite_store_unavailable', 'Invite storage is unavailable.');
    }
    let invite: Invite;
    try { invite = JSON.parse(await readFile(used, 'utf8')); } catch { throw invalid(); }
    if (!Number.isSafeInteger(invite.expiresAt) || invite.expiresAt <= now
      || !Number.isInteger(invite.lifetimeSeconds) || invite.lifetimeSeconds < 60 || invite.lifetimeSeconds > 3600
      || typeof invite.combat !== 'boolean' || typeof invite.chat !== 'boolean') throw invalid();
    return invite;
  }
}
