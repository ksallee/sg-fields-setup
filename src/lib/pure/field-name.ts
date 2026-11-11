/**
 * The programmatic name the server will give a new field (MOD-17 to MOD-20, G11).
 *
 * The rule lives in sg-widgets core. Import it from here, so a change of source is one line.
 * `predictFieldName(displayName, dataType)` answers `sg_<data_type>` for a display name with a
 * non-ASCII character, and null for one without its data type (findings/117_field_types_and_names).
 */
export { CUSTOM_FIELD_PREFIX, hasNonAscii, predictFieldName } from 'sg-widgets-core';
