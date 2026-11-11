/**
 * Which projects are eligible for field visibility (VIS-2, Q4): not a template, not archived,
 * not a demo project. Status is never read (B5, corpus `findings/018_project_listing`).
 *
 * The rule lives in sg-widgets core. Until a release carries it this re-exports the verbatim
 * copy in `vendor-core` (issue #21). Import it from here only: the swap to `sg-widgets-core` is
 * this one line.
 */
export { PROJECT_ELIGIBILITY_FIELDS, eligibleProjects, isEligibleProject, type EligibilityFlags } from '../vendor-core/project-eligibility';
