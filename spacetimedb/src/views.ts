import spacetimedb from './schema';

/** Each client only ever sees its own inventory rows. */
export const inventoryVisibility = spacetimedb.clientVisibilityFilter.sql(
  'SELECT * FROM inventory_slot WHERE owner = :sender'
);
