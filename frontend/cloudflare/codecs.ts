import { AlgebraicType, ProductType, type Serializer } from 'spacetimedb';
import { tables, reducers, procedures } from '../src/module_bindings';
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

// Every DbConnection builds its procedure argument types afresh, so the SDK's
// cache (keyed by object identity) misses and would call Function() inside a
// request. Compile them now and answer later lookups of the same shape.
const procedureArgs = new Map<string, Map<string, Serializer<any>>>();
type Product = Parameters<typeof ProductType.makeSerializer>[0];
const names = (ty: Product) => ty.elements.map((element) => element.name).join(',');
for (const procedure of Object.values(procedures)) {
  const params = procedure.params as Record<string, { algebraicType: AlgebraicType }>;
  const args: Product = { elements: Object.keys(params).map((name) => ({ name, algebraicType: params[name].algebraicType })) };
  const byShape = procedureArgs.get(names(args)) ?? new Map<string, Serializer<any>>();
  byShape.set(JSON.stringify(args), ProductType.makeSerializer(args));
  procedureArgs.set(names(args), byShape);
  AlgebraicType.makeDeserializer(procedure.returnType.algebraicType);
}
const makeSerializer = ProductType.makeSerializer;
ProductType.makeSerializer = (ty, typespace) =>
  procedureArgs.get(names(ty))?.get(JSON.stringify(ty)) ?? makeSerializer(ty, typespace);
