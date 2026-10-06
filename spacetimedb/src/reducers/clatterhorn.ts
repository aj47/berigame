import { SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';

/**
 * Walk up to Clatterhorn in its glade and keep swinging from within
 * Chebyshev 2 of its centre (Pending.Clatterhorn). PvE, open to everyone; a
 * landed swing ends spawn grace; its blows never clear the swing loop.
 *
 * WP0 stub with the final (empty) argument schema; WP5 fills it in.
 */
export const attackClatterhorn = spacetimedb.reducer((_ctx) => {
  throw new SenderError('This boss is not ready yet');
});
