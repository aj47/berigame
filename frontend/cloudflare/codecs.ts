import { AlgebraicType, ProductType } from 'spacetimedb';
import { tables, reducers } from '../src/module_bindings';
import * as protocol from '#spacetime-wire';

// SpacetimeDB 2.10 generates and caches binary codecs with Function(). Cloudflare
// permits that during module startup only. Compile our checked-in schema and
// the SDK's own wire types before any request runs; no user input is compiled.
// The Wrangler alias ensures these imports share the same SDK/cache instance.
for (const table of Object.values(tables)) {
  ProductType.makeSerializer(table.rowType);
  ProductType.makeDeserializer(table.rowType);
}
for (const reducer of Object.values(reducers)) {
  ProductType.makeSerializer(reducer.paramsType);
  ProductType.makeDeserializer(reducer.paramsType);
}
for (const type of Object.values(protocol)) {
  AlgebraicType.makeSerializer(type.algebraicType);
  AlgebraicType.makeDeserializer(type.algebraicType);
}
