import spacetimedb from './schema';

/** Each client only ever sees its own inventory rows. */
export const inventoryVisibility = spacetimedb.clientVisibilityFilter.sql(
  'SELECT * FROM inventory_slot WHERE owner = :sender'
);

/** Your own invite code only: codes cannot be listed by anyone else. */
export const inviteCodeVisibility = spacetimedb.clientVisibilityFilter.sql(
  'SELECT * FROM invite_code WHERE inviter = :sender'
);

/** Your own friends list only. */
export const friendVisibility = spacetimedb.clientVisibilityFilter.sql(
  'SELECT * FROM friend WHERE owner = :sender'
);

/** Trades you are part of (either side). Multiple filters on a table are combined with OR. */
export const tradeVisibilityA = spacetimedb.clientVisibilityFilter.sql(
  'SELECT * FROM trade WHERE a = :sender'
);
export const tradeVisibilityB = spacetimedb.clientVisibilityFilter.sql(
  'SELECT * FROM trade WHERE b = :sender'
);

/** Social notices (an event table): each client receives only the ones addressed to it. */
export const socialEventVisibility = spacetimedb.clientVisibilityFilter.sql(
  'SELECT * FROM social_event WHERE "to" = :sender'
);
