/**
 * The programmatic name the server will give a new field (MOD-17 to MOD-20).
 *
 * The rule lives in sg-widgets core. Until a release carries it this re-exports the verbatim
 * copy in `vendor-core` (issue #21). Import it from here only: the swap to `sg-widgets-core` is
 * this one line.
 */
export { CUSTOM_FIELD_PREFIX, predictFieldName } from '../vendor-core/field-name';
