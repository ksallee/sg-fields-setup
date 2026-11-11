/**
 * The entity types whose fields are read ahead (SET-25), in the order the import's inference
 * tries them (IMP-15). Fixed: the warm-up never reads every type (SET-26).
 */
export const COMMON_ENTITY_TYPES = ['Shot', 'Asset', 'Sequence', 'Task', 'Version', 'Note', 'Project'] as const;
